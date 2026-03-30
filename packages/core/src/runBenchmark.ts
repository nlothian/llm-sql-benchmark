import { checkBenchmarkResult, isBenchmarkPass } from './check';
import {
  BENCHMARK_TOOLS,
  buildGrammarSystemPrompt,
  buildResultSummary,
  buildToolSystemPrompt,
  stripThinkTags,
} from './prompt';
import { buildGrammar } from './grammar';
import type {
  BenchmarkClient,
  BenchmarkDifficulty,
  BenchmarkConversationMessage,
  BenchmarkDataset,
  BenchmarkSqlRunner,
  BenchmarkQuestion,
  BenchmarkReport,
  BenchmarkRunRecord,
  QueryResult,
  RunBenchmarkOptions,
  SchemaTable,
  TokenUsage,
} from './types';

const MAX_TOOL_CALLS = 20;

class RunAbortedError extends Error {
  constructor() {
    super('Benchmark run aborted');
    this.name = 'RunAbortedError';
  }
}

interface QuestionExecutionResult {
  generatedSql: string | null;
  queryResult: QueryResult | null;
  error: string | null;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  modelName: string | null;
}

interface QuestionExecutionOptions {
  question: BenchmarkQuestion;
  schema: SchemaTable;
  client: BenchmarkClient;
  timeoutMs: number;
  maxRetries: number;
  grammar?: { initial: string; check: string };
  runner: BenchmarkSqlRunner;
  abortSignal?: AbortSignal;
  onStatus?: (message: string) => void;
}

function selectQuestions(
  dataset: BenchmarkDataset,
  difficulties?: BenchmarkDifficulty[],
  questionIds?: number[],
): BenchmarkQuestion[] {
  let questions: BenchmarkQuestion[];

  if (questionIds && questionIds.length > 0) {
    // Preserve caller-specified order of questionIds
    const qMap = new Map(dataset.questions.map(q => [q.id, q]));
    questions = questionIds.map(id => qMap.get(id)).filter((q): q is BenchmarkQuestion => q != null);
  } else {
    questions = [...dataset.questions];
  }

  if (difficulties && difficulties.length > 0) {
    const diffSet = new Set(difficulties);
    questions = questions.filter(q => diffSet.has(q.difficulty));
  }

  return questions;
}

function createEmptyReport(
  dataset: BenchmarkDataset,
  startedAt: string,
  completedAt: string,
  modelName: string | null,
  aborted: boolean,
): BenchmarkReport {
  return {
    meta: {
      datasetId: dataset.id,
      datasetName: dataset.name,
      startedAt,
      completedAt,
      durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
      modelName,
      aborted,
    },
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      errored: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: null,
    },
    results: [],
  };
}

function createQuestionAbortSignal(timeoutMs: number, parent?: AbortSignal): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;

  if (parent?.aborted) {
    controller.abort();
    return { signal: controller.signal, didTimeout: () => false, cleanup: () => {} };
  }

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onParentAbort = () => controller.abort();
  parent?.addEventListener('abort', onParentAbort);

  const cleanup = () => {
    clearTimeout(timeoutHandle);
    parent?.removeEventListener('abort', onParentAbort);
  };

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup,
  };
}

async function runToolCallingQuestion(options: QuestionExecutionOptions): Promise<QuestionExecutionResult> {
  const {
    question,
    schema,
    client,
    timeoutMs,
    maxRetries,
    runner,
    abortSignal,
    onStatus,
  } = options;

  if (client.mode !== 'tool-calling') {
    throw new Error('Tool-calling client required for tool mode.');
  }

  const { signal, didTimeout, cleanup } = createQuestionAbortSignal(timeoutMs, abortSignal);
  const messages: BenchmarkConversationMessage[] = [{ role: 'user', content: question.question }];
  const systemPrompt = buildToolSystemPrompt(schema);

  let lastSql: string | null = null;
  let lastResult: QueryResult | null = null;
  let attempts = 0;
  let retryCount = 0;
  let totalCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cost: number | null = null;
  let resolvedModel: string | null = null;
  const countToolCallAttempt = () => {
    if (totalCalls >= MAX_TOOL_CALLS) {
      throw new Error(`Exceeded maximum tool calls (${MAX_TOOL_CALLS})`);
    }
    totalCalls++;
  };

  try {
    while (totalCalls < MAX_TOOL_CALLS) {
      if (abortSignal?.aborted) throw new RunAbortedError();
      if (signal.aborted) {
        if (didTimeout()) {
          return {
            generatedSql: lastSql,
            queryResult: null,
            error: `Timeout after ${Math.ceil(timeoutMs / 1000)}s`,
            attempts,
            inputTokens,
            outputTokens,
            cost,
            modelName: resolvedModel,
          };
        }
        throw new RunAbortedError();
      }

      onStatus?.(`Calling LLM (attempt ${totalCalls + 1})`);

      const onTokenUsage = (usage: TokenUsage) => {
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
        if (usage.cost !== undefined) {
          cost = (cost ?? 0) + usage.cost;
        }
      };

      const response = await client.call({
        systemPrompt,
        messages,
        tools: [...BENCHMARK_TOOLS],
        abortSignal: signal,
        onTokenUsage,
        onClientCallAttempt: countToolCallAttempt,
        onModelName: (name) => {
          resolvedModel = name;
        },
      });

      if (response.functionName === 'results_ok') {
        return {
          generatedSql: lastSql,
          queryResult: lastResult,
          error: null,
          attempts,
          inputTokens,
          outputTokens,
          cost,
          modelName: resolvedModel,
        };
      }

      if (response.functionName === 'run_sql_query') {
        const sql = (response.arguments.sql as string) ?? '';
        lastSql = sql;
        attempts++;

        messages.push({
          role: 'assistant',
          toolCall: { id: response.toolCallId, name: 'run_sql_query', arguments: response.arguments },
          ...(response.thoughtSignature ? { thoughtSignature: response.thoughtSignature } : {}),
        });

        onStatus?.(`Executing SQL (attempt ${attempts})`);

        try {
          const result = await runner.runQuery(sql);
          lastResult = result;
          retryCount = 0;

          messages.push({
            role: 'tool_result',
            toolCallId: response.toolCallId,
            content: buildResultSummary(result),
          });
        } catch (error) {
          const message = (error as Error).message;
          if (retryCount >= maxRetries) {
            return {
              generatedSql: lastSql,
              queryResult: null,
              error: `Query failed after ${maxRetries} retries: ${message}`,
              attempts,
              inputTokens,
              outputTokens,
              cost,
              modelName: resolvedModel,
            };
          }

          retryCount++;
          messages.push({
            role: 'tool_result',
            toolCallId: response.toolCallId,
            content: `Error executing query. Fix this error and call run_sql_query again. Error: ${message}`,
          });
        }
      } else {
        messages.push({
          role: 'assistant',
          toolCall: { id: response.toolCallId, name: response.functionName, arguments: response.arguments },
          ...(response.thoughtSignature ? { thoughtSignature: response.thoughtSignature } : {}),
        });
        messages.push({
          role: 'tool_result',
          toolCallId: response.toolCallId,
          content: `Unknown tool "${response.functionName}". Available tools: run_sql_query, results_ok`,
        });
      }
    }

    return {
      generatedSql: lastSql,
      queryResult: lastResult,
      error: `Exceeded maximum tool calls (${MAX_TOOL_CALLS})`,
      attempts,
      inputTokens,
      outputTokens,
      cost,
      modelName: resolvedModel,
    };
  } catch (error) {
    if (didTimeout()) {
      return {
        generatedSql: lastSql,
        queryResult: null,
        error: `Timeout after ${Math.ceil(timeoutMs / 1000)}s`,
        attempts,
        inputTokens,
        outputTokens,
        cost,
        modelName: resolvedModel,
      };
    }

    if (abortSignal?.aborted || signal.aborted) {
      throw new RunAbortedError();
    }

    if (
      (error as Error).name === 'AbortError' ||
      (error as Error).message?.includes('The operation was aborted')
    ) {
      return {
        generatedSql: lastSql,
        queryResult: null,
        error: 'Request aborted unexpectedly (network or connection issue)',
        attempts,
        inputTokens,
        outputTokens,
        cost,
        modelName: resolvedModel,
      };
    }

    return {
      generatedSql: lastSql,
      queryResult: null,
      error: (error as Error).message,
      attempts,
      inputTokens,
      outputTokens,
      cost,
      modelName: resolvedModel,
    };
  } finally {
    cleanup();
  }
}

async function runGrammarQuestion(options: QuestionExecutionOptions): Promise<QuestionExecutionResult> {
  const {
    question,
    schema,
    client,
    timeoutMs,
    maxRetries,
    grammar,
    runner,
    abortSignal,
    onStatus,
  } = options;

  if (client.mode !== 'grammar') {
    throw new Error('Grammar client required for grammar mode.');
  }
  if (!grammar) {
    throw new Error('Grammar mode requires grammar strings.');
  }

  const { signal, didTimeout, cleanup } = createQuestionAbortSignal(timeoutMs, abortSignal);
  const systemPrompt = buildGrammarSystemPrompt(schema);
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: question.question },
  ];

  let lastSql: string | null = null;
  let lastResult: QueryResult | null = null;
  let attempts = 0;
  let retryCount = 0;
  let totalCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cost: number | null = null;
  let resolvedModel: string | null = null;

  try {
    while (totalCalls < MAX_TOOL_CALLS) {
      if (abortSignal?.aborted) throw new RunAbortedError();
      if (signal.aborted) {
        if (didTimeout()) {
          return {
            generatedSql: lastSql,
            queryResult: null,
            error: `Timeout after ${Math.ceil(timeoutMs / 1000)}s`,
            attempts,
            inputTokens,
            outputTokens,
            cost,
            modelName: resolvedModel,
          };
        }
        throw new RunAbortedError();
      }

      totalCalls++;
      onStatus?.(`Calling LLM grammar mode (attempt ${attempts + 1})`);

      const onTokenUsage = (usage: TokenUsage) => {
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
        if (usage.cost !== undefined) {
          cost = (cost ?? 0) + usage.cost;
        }
      };

      const { text } = await client.generate({
        systemPrompt,
        messages,
        grammar: totalCalls === 1 ? grammar.initial : grammar.check,
        abortSignal: signal,
        onTokenUsage,
        onModelName: (name) => {
          resolvedModel = name;
        },
      });

      const output = stripThinkTags(text);
      messages.push({ role: 'assistant', content: output });

      if (output === 'OK') {
        return {
          generatedSql: lastSql,
          queryResult: lastResult,
          error: null,
          attempts,
          inputTokens,
          outputTokens,
          cost,
          modelName: resolvedModel,
        };
      }

      lastSql = output;
      attempts++;
      onStatus?.(`Executing SQL (attempt ${attempts})`);

      try {
        const result = await runner.runQuery(output);
        lastResult = result;
        retryCount = 0;

        messages.push({
          role: 'user',
          content: buildResultSummary(result, 'grammar'),
        });
      } catch (error) {
        const message = (error as Error).message;
        if (retryCount >= maxRetries) {
          return {
            generatedSql: lastSql,
            queryResult: null,
            error: `Query failed after ${maxRetries} retries: ${message}`,
            attempts,
            inputTokens,
            outputTokens,
            cost,
            modelName: resolvedModel,
          };
        }
        retryCount++;
        messages.push({
          role: 'user',
          content: `Error executing query: ${message}\n\nOutput corrected SQL only.`,
        });
      }
    }

    return {
      generatedSql: lastSql,
      queryResult: lastResult,
      error: `Exceeded maximum tool calls (${MAX_TOOL_CALLS})`,
      attempts,
      inputTokens,
      outputTokens,
      cost,
      modelName: resolvedModel,
    };
  } catch (error) {
    if (didTimeout()) {
      return {
        generatedSql: lastSql,
        queryResult: null,
        error: `Timeout after ${Math.ceil(timeoutMs / 1000)}s`,
        attempts,
        inputTokens,
        outputTokens,
        cost,
        modelName: resolvedModel,
      };
    }

    if (abortSignal?.aborted || signal.aborted) {
      throw new RunAbortedError();
    }

    if (
      (error as Error).name === 'AbortError' ||
      (error as Error).message?.includes('The operation was aborted')
    ) {
      return {
        generatedSql: lastSql,
        queryResult: null,
        error: 'Request aborted unexpectedly (network or connection issue)',
        attempts,
        inputTokens,
        outputTokens,
        cost,
        modelName: resolvedModel,
      };
    }

    return {
      generatedSql: lastSql,
      queryResult: null,
      error: (error as Error).message,
      attempts,
      inputTokens,
      outputTokens,
      cost,
      modelName: resolvedModel,
    };
  } finally {
    cleanup();
  }
}

function buildReport(
  dataset: BenchmarkDataset,
  startedAt: string,
  completedAt: string,
  modelName: string | null,
  aborted: boolean,
  results: BenchmarkRunRecord[],
): BenchmarkReport {
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const errored = results.filter(r => r.status === 'error').length;
  const totalInputTokens = results.reduce((sum, r) => sum + r.inputTokens, 0);
  const totalOutputTokens = results.reduce((sum, r) => sum + r.outputTokens, 0);
  const totalCost = results.some(r => r.cost !== null)
    ? results.reduce((sum, r) => sum + (r.cost ?? 0), 0)
    : null;

  return {
    meta: {
      datasetId: dataset.id,
      datasetName: dataset.name,
      startedAt,
      completedAt,
      durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
      modelName,
      aborted,
    },
    summary: {
      total: results.length,
      passed,
      failed,
      errored,
      totalInputTokens,
      totalOutputTokens,
      totalCost,
    },
    results,
  };
}

async function executeQuestion(options: QuestionExecutionOptions): Promise<QuestionExecutionResult> {
  if (options.client.mode === 'tool-calling') {
    return runToolCallingQuestion(options);
  }
  return runGrammarQuestion(options);
}

export async function runBenchmark(options: RunBenchmarkOptions): Promise<BenchmarkReport> {
  const {
    dataset,
    runner,
    client,
    difficulties,
    questionIds,
    timeoutMs = 120_000,
    maxRetries = 2,
    grammar,
    abortSignal,
    onEvent,
  } = options;

  const startedAt = new Date().toISOString();
  const questions = selectQuestions(dataset, difficulties, questionIds);
  let modelName: string | null = null;

  onEvent?.({ type: 'run-started', totalQuestions: questions.length, startedAt });

  if (questions.length === 0) {
    const report = createEmptyReport(dataset, startedAt, new Date().toISOString(), null, false);
    onEvent?.({ type: 'run-completed', report });
    return report;
  }

  const records: BenchmarkRunRecord[] = [];

  try {
    await runner.loadDataset(dataset);
    onEvent?.({ type: 'dataset-loaded' });
    const schema = await runner.getSchema();

    for (const [index, question] of questions.entries()) {
      if (abortSignal?.aborted) {
        throw new RunAbortedError();
      }

      onEvent?.({
        type: 'question-started',
        index,
        total: questions.length,
        question,
      });

      const questionStart = Date.now();
      const result = await executeQuestion({
        question,
        schema,
        client,
        timeoutMs,
        maxRetries,
        grammar: client.mode === 'grammar'
          ? {
              initial: grammar ?? buildGrammar(schema, { allowOk: false }),
              check: grammar ?? buildGrammar(schema),
            }
          : undefined,
        runner,
        abortSignal,
        onStatus: (message) => {
          onEvent?.({ type: 'status', message, questionId: question.id });
        },
      });

      modelName = result.modelName ?? modelName;
      const check = result.error ? null : checkBenchmarkResult(question, result.queryResult);

      const record: BenchmarkRunRecord = {
        question,
        generatedSql: result.generatedSql,
        queryResult: result.queryResult,
        error: result.error,
        check,
        durationMs: Date.now() - questionStart,
        attempts: result.attempts,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cost: result.cost,
        status: result.error ? 'error' : (isBenchmarkPass(check) ? 'pass' : 'fail'),
      };

      records.push(record);
      onEvent?.({
        type: 'question-completed',
        index,
        total: questions.length,
        record,
      });
    }

    const report = buildReport(dataset, startedAt, new Date().toISOString(), modelName, false, records);
    onEvent?.({ type: 'run-completed', report });
    return report;
  } catch (error) {
    if (error instanceof RunAbortedError) {
      const report = buildReport(dataset, startedAt, new Date().toISOString(), modelName, true, records);
      onEvent?.({ type: 'run-aborted', report });
      return report;
    }
    throw error;
  }
}
