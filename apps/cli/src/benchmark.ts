import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, parse, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type {
  BenchmarkClient,
  BenchmarkDataset,
  BenchmarkDifficulty,
  BenchmarkQuestion,
} from '@fifthvertex/benchmark-core';
import { runBenchmark } from '@fifthvertex/benchmark-core';
import { benchmarkDataset as bundledDataset } from '@fifthvertex/benchmark-data-adventureworks';
import { getNodeTablePath } from '@fifthvertex/benchmark-data-adventureworks/table-paths';
import { createOpenAiGrammarClient, createOpenAiToolCallingClient } from './client-adapters.ts';
import { NodeDuckDbRunner } from './duckdb-runner.ts';
import { formatQuestionLabel, type LlmLogContext, type LlmLogEntry } from './llm-logging.ts';

type ReasoningEffort = 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';

interface CliArgs {
  endpoint: string;
  apiKey: string;
  model: string;
  dataDir?: string;
  difficulties?: string[];
  timeoutSec: number;
  questionId?: number;
  output?: string;
  outputDir?: string;
  modelVariant?: string;
  grammar: boolean;
  reasoningEffort?: ReasoningEffort;
  throttleTimeSec?: number;
  weightsAvailable: 'open' | 'closed';
}

function parseCliArgs(argv: string[]): { args: CliArgs | null; exitCode: number; warnings: string[] } {
  const warnings: string[] = [];
  const { values } = parseArgs({
    args: argv,
    options: {
      endpoint: { type: 'string' },
      'api-key': { type: 'string' },
      model: { type: 'string' },
      'data-dir': { type: 'string' },
      difficulty: { type: 'string', multiple: true },
      timeout: { type: 'string' },
      question: { type: 'string' },
      output: { type: 'string' },
      'output-dir': { type: 'string' },
      'model-variant': { type: 'string' },
      'reasoning-effort': { type: 'string' },
      'throttle-time': { type: 'string' },
      'weights-available': { type: 'string' },
      grammar: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`Usage: npx tsx apps/cli/src/benchmark.ts [options]

Options:
  --endpoint <url>       OpenAI-compatible API endpoint
  --api-key <key>        API key (Bearer token)
  --model <name>         Model name to send to API
  --data-dir <path>      Optional custom dataset dir (questions.json + tables/*.csv)
  --difficulty <level>   Filter by difficulty: trivial, easy, medium, hard (repeatable)
  --timeout <seconds>    Per-question timeout (default: 120)
  --question <id>        Run a single question by ID
  --output <path>        Output JSON file (default: data/benchmarks/benchmark-<model>.json)
  --output-dir <dir>     Directory for default output file (default: data/benchmarks)
  --model-variant <tag>  Appended to default output filename
  --reasoning-effort <l> Reasoning effort (xhigh, high, medium, low, minimal, none)
  --throttle-time <seconds> Minimum delay between any LLM calls in a run
  --weights-available <v>  Model weights availability: open or closed (default: open)
  --grammar              Grammar-constrained mode
  -h, --help             Show this help message`);
    return { args: null, exitCode: 0, warnings: [] };
  }

  if (!values.endpoint) {
    console.error('Error: --endpoint is required');
    return { args: null, exitCode: 1, warnings: [] };
  }
  if (!values.model) {
    console.error('Error: --model is required');
    return { args: null, exitCode: 1, warnings: [] };
  }

  if (values.grammar && values.endpoint?.startsWith('https://openrouter.ai/api/v1/chat/completions')) {
    warnings.push('Warning: OpenRouter does not support grammar. The grammar parameter will likely be ignored.');
  }

  const allowedEfforts: ReasoningEffort[] = ['xhigh', 'high', 'medium', 'low', 'minimal', 'none'];
  const rawEffort = values['reasoning-effort'];
  if (rawEffort && !allowedEfforts.includes(rawEffort as ReasoningEffort)) {
    console.error(`Error: --reasoning-effort must be one of: ${allowedEfforts.join(', ')}`);
    return { args: null, exitCode: 1, warnings: [] };
  }

  const rawWeights = values['weights-available'];
  const allowedWeights = ['open', 'closed'] as const;
  if (rawWeights && !allowedWeights.includes(rawWeights as 'open' | 'closed')) {
    console.error(`Error: --weights-available must be one of: ${allowedWeights.join(', ')}`);
    return { args: null, exitCode: 1, warnings: [] };
  }

  const grammarEnabled = values.grammar ?? false;
  const modelVariant = values['model-variant'] ?? (grammarEnabled ? 'grammar' : undefined);

  const rawThrottleTime = values['throttle-time'];
  let throttleTimeSec: number | undefined;
  if (rawThrottleTime !== undefined) {
    const parsedThrottleTime = Number(rawThrottleTime);
    if (!Number.isFinite(parsedThrottleTime) || parsedThrottleTime < 0) {
      console.error('Error: --throttle-time must be a finite number >= 0');
      return { args: null, exitCode: 1, warnings: [] };
    }
    throttleTimeSec = parsedThrottleTime;
  }

  return {
    args: {
      endpoint: values.endpoint,
      apiKey: values['api-key'] ?? '',
      model: values.model,
      dataDir: values['data-dir'] ?? undefined,
      difficulties: values.difficulty as string[] | undefined,
      timeoutSec: values.timeout ? Number(values.timeout) : 120,
      questionId: values.question ? Number(values.question) : undefined,
      output: values.output,
      outputDir: values['output-dir'],
      modelVariant,
      reasoningEffort: rawEffort as ReasoningEffort | undefined,
      throttleTimeSec,
      grammar: grammarEnabled,
      weightsAvailable: (rawWeights as 'open' | 'closed') ?? 'open',
    },
    exitCode: 0,
    warnings,
  };
}

function deriveTableFiles(registerTables: string[]): string[] {
  return registerTables
    .map(sql => sql.match(/read_csv_auto\('([^']+)'\)/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map(match => match[1]);
}

function loadDatasetFromDirectory(dataDir: string): BenchmarkDataset {
  const questionsPath = resolve(dataDir, 'questions.json');
  const raw = readFileSync(questionsPath, 'utf-8');
  const parsed = JSON.parse(raw) as
    | { questions: BenchmarkQuestion[]; registertables?: string[] }
    | BenchmarkQuestion[];

  const questions = Array.isArray(parsed) ? parsed : parsed.questions;
  const registerTables = Array.isArray(parsed) ? [] : (parsed.registertables ?? []);
  const tableFiles = deriveTableFiles(registerTables);

  return {
    id: 'custom',
    name: `Custom Dataset (${dataDir})`,
    questions,
    registerTables,
    tableFiles,
  };
}

function mapDifficulties(values?: string[]): BenchmarkDifficulty[] | undefined {
  if (!values || values.length === 0) return undefined;
  const allowed: BenchmarkDifficulty[] = ['trivial', 'easy', 'medium', 'hard'];
  const filtered = values.filter((value): value is BenchmarkDifficulty => allowed.includes(value as BenchmarkDifficulty));
  return filtered.length > 0 ? filtered : undefined;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildDefaultBenchmarkFilename(model: string, modelVariant?: string): string {
  const modelSlug = sanitizePathSegment(model);
  const variantSuffix = modelVariant ? `-${sanitizePathSegment(modelVariant)}` : '';
  return `benchmark-${modelSlug}${variantSuffix}.json`;
}

function formatRunTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function createJsonlLogger(logPath: string): (entry: LlmLogEntry) => void {
  return (entry) => {
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf-8');
  };
}

function createAbortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

async function waitWithAbort(timeoutMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (timeoutMs <= 0) return;
  if (abortSignal?.aborted) throw createAbortError();

  await new Promise<void>((resolve, reject) => {
    let handle: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(handle);
      abortSignal?.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };

    handle = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, timeoutMs);

    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

function createThrottledClient(
  client: BenchmarkClient,
  throttleTimeSec: number,
  getLastLlmCallEndedAtMs: () => number | null,
  setLastLlmCallEndedAtMs: (value: number) => void,
  onThrottleWait?: (waitedMs: number) => void,
): BenchmarkClient {
  const throttleTimeMs = throttleTimeSec * 1000;

  if (throttleTimeMs <= 0) {
    return client;
  }

  const waitForThrottle = async (abortSignal?: AbortSignal) => {
    const lastCallEndedAtMs = getLastLlmCallEndedAtMs();
    if (lastCallEndedAtMs === null) return;

    const elapsedMs = Date.now() - lastCallEndedAtMs;
    const remainingMs = throttleTimeMs - elapsedMs;
    if (remainingMs > 0) {
      const waitStart = Date.now();
      try {
        await waitWithAbort(remainingMs, abortSignal);
      } finally {
        onThrottleWait?.(Date.now() - waitStart);
      }
    }
  };

  if (client.mode === 'tool-calling') {
    return {
      mode: 'tool-calling',
      async call(options) {
        await waitForThrottle(options.abortSignal);
        try {
          return await client.call(options);
        } finally {
          setLastLlmCallEndedAtMs(Date.now());
        }
      },
    };
  }

  return {
    mode: 'grammar',
    async generate(options) {
      await waitForThrottle(options.abortSignal);
      try {
        return await client.generate(options);
      } finally {
        setLastLlmCallEndedAtMs(Date.now());
      }
    },
  };
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: CliArgs;
  try {
    const parsed = parseCliArgs(argv);
    if (!parsed.args) {
      return parsed.exitCode;
    }
    if (parsed.warnings.length > 0) {
      for (const warning of parsed.warnings) {
        console.warn(warning);
      }
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>(resolve => rl.question('Continue? (Y/n) ', resolve));
      rl.close();
      if (answer.trim().toUpperCase() !== 'Y') {
        console.log('Aborted.');
        return 1;
      }
    }
    args = parsed.args;
  } catch (error) {
    console.error(`Error parsing arguments: ${(error as Error).message}`);
    return 1;
  }

  const dataset = args.dataDir ? loadDatasetFromDirectory(args.dataDir) : bundledDataset;
  const defaultFilename = buildDefaultBenchmarkFilename(args.model, args.modelVariant);
  const defaultOutputDir = resolve('data/benchmarks');
  const outputPath = args.output ?? join(args.outputDir ?? defaultOutputDir, defaultFilename);
  const benchmarkFileName = basename(outputPath);
  const benchmarkFileStem = parse(benchmarkFileName).name;
  const runTimestamp = formatRunTimestamp();
  const runId = `${benchmarkFileStem}-${runTimestamp}`;
  const logsDir = resolve('data/logs');
  const logFileName = `${runId}.jsonl`;
  const logPath = join(logsDir, logFileName);
  mkdirSync(logsDir, { recursive: true });

  const writeLogEntry = createJsonlLogger(logPath);
  let activeQuestion: BenchmarkQuestion | null = null;
  let callIndex = 0;
  let lastLlmCallEndedAtMs: number | null = null;
  let questionThrottleWaitMs = 0;
  const throttleWaitByQuestionId = new Map<number, number>();
  const getLogContext = (): LlmLogContext => {
    callIndex += 1;
    return {
      runId,
      benchmarkFileName,
      logFileName,
      questionId: activeQuestion?.id ?? null,
      questionDifficulty: activeQuestion?.difficulty ?? null,
      questionText: activeQuestion?.question ?? null,
      questionLabel: formatQuestionLabel(activeQuestion),
      callIndex,
    };
  };

  const questionIds = args.questionId !== undefined ? [args.questionId] : undefined;
  const difficulties = mapDifficulties(args.difficulties);

  const runner = await NodeDuckDbRunner.create((tableFile) => {
    if (args.dataDir) {
      const normalized = tableFile.startsWith('tables/') ? tableFile.slice('tables/'.length) : tableFile;
      return resolve(args.dataDir, 'tables', normalized);
    }
    return getNodeTablePath(tableFile);
  });

  const clientConfig = {
    endpoint: args.endpoint,
    apiKey: args.apiKey,
    model: args.model,
    reasoningEffort: args.reasoningEffort,
    getLogContext,
    logger: writeLogEntry,
  };
  const baseClient = args.grammar
    ? createOpenAiGrammarClient(clientConfig)
    : createOpenAiToolCallingClient(clientConfig);
  const client = args.throttleTimeSec === undefined
    ? baseClient
    : createThrottledClient(
        baseClient,
        args.throttleTimeSec,
        () => lastLlmCallEndedAtMs,
        (value) => {
          lastLlmCallEndedAtMs = value;
        },
        (waitedMs) => {
          questionThrottleWaitMs += waitedMs;
        },
      );

  console.log('Benchmark CLI');
  console.log(`  Endpoint: ${args.endpoint}`);
  console.log(`  Model:    ${args.model}`);
  console.log(`  Dataset:  ${dataset.name}`);
  console.log(`  Timeout:  ${args.timeoutSec}s per question`);
  if (args.throttleTimeSec !== undefined) console.log(`  Throttle: ${args.throttleTimeSec}s between all LLM calls`);
  console.log(`  Output:   ${outputPath}`);
  console.log(`  Logs:     ${logPath}`);
  if (args.modelVariant) console.log(`  Variant:  ${args.modelVariant}`);
  if (args.reasoningEffort) console.log(`  Reason:   ${args.reasoningEffort}`);
  if (args.grammar) console.log('  Mode:     grammar-constrained');
  console.log();

  try {
    const report = await runBenchmark({
      dataset,
      runner,
      client,
      timeoutMs: args.timeoutSec * 1000,
      questionIds,
      difficulties,
      onEvent: (event) => {
        if (event.type === 'run-started') {
          console.log(`Running ${event.totalQuestions} question(s)...\n`);
          return;
        }

        if (event.type === 'question-started') {
          activeQuestion = event.question;
          callIndex = 0;
          questionThrottleWaitMs = 0;
          process.stdout.write(`[Q${event.question.id}] (${event.question.difficulty}) ${event.question.question.slice(0, 80)}...`);
          return;
        }

        if (event.type === 'question-completed') {
          const { record } = event;
          const adjustedMs = Math.max(0, (record.durationMs ?? 0) - questionThrottleWaitMs);
          if (questionThrottleWaitMs > 0) {
            throttleWaitByQuestionId.set(record.question.id, questionThrottleWaitMs);
          }
          if (record.status === 'pass') {
            console.log(` PASS (${adjustedMs}ms, ${record.attempts} attempt(s))`);
          } else if (record.status === 'fail') {
            console.log(` FAIL (${adjustedMs}ms, ${record.attempts} attempt(s))`);
            if (record.check && !record.check.rowCountMatch) {
              console.log(`  Row count: expected ${record.question.row_count}, got ${record.check.actualRowCount}`);
            }
            if (record.check && !record.check.columnNamesMatch) {
              if (record.check.missingColumns.length > 0) console.log(`  Missing columns: ${record.check.missingColumns.join(', ')}`);
              if (record.check.extraColumns.length > 0) console.log(`  Extra columns: ${record.check.extraColumns.join(', ')}`);
            }
            if (record.generatedSql) console.log(`  SQL: ${record.generatedSql}`);
          } else {
            console.log(` ERROR (${adjustedMs}ms): ${record.error}`);
            if (record.generatedSql) console.log(`  Last SQL: ${record.generatedSql}`);
          }
          console.log();
          activeQuestion = null;
          return;
        }

        if (event.type === 'run-completed' || event.type === 'run-aborted') {
          activeQuestion = null;
        }
      },
    });

    console.log('='.repeat(60));
    console.log(
      `Results: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.errored} errored out of ${report.summary.total}`,
    );
    if (report.summary.totalInputTokens > 0 || report.summary.totalOutputTokens > 0) {
      console.log(`Tokens:  ${report.summary.totalInputTokens} input, ${report.summary.totalOutputTokens} output`);
    }
    if (report.summary.totalCost !== null) {
      console.log(`Cost:    $${report.summary.totalCost.toFixed(6)}`);
    }
    console.log('='.repeat(60));

    if (args.outputDir) mkdirSync(args.outputDir, { recursive: true });

    const output = {
      meta: {
        endpoint: args.endpoint,
        model: report.meta.modelName ?? args.model,
        ...(args.modelVariant ? { modelVariant: args.modelVariant } : {}),
        ...(args.throttleTimeSec !== undefined ? { throttleTimeSec: args.throttleTimeSec } : {}),
        timestamp: new Date().toISOString(),
        timeoutSec: args.timeoutSec,
        datasetId: report.meta.datasetId,
        datasetName: report.meta.datasetName,
        weightsAvailable: args.weightsAvailable,
        grammarEnabled: args.grammar,
        aborted: report.meta.aborted,
      },
      summary: report.summary,
      results: report.results.map(record => {
        const throttleMs = throttleWaitByQuestionId.get(record.question.id) ?? 0;
        return {
        id: record.question.id,
        question: record.question.question,
        difficulty: record.question.difficulty,
        status: record.status,
        durationMs: Math.max(0, (record.durationMs ?? 0) - throttleMs),
        ...(throttleMs > 0 ? { throttleWaitMs: throttleMs } : {}),
        attempts: record.attempts,
        sql: record.generatedSql,
        error: record.error,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        cost: record.cost,
        result: record.queryResult
          ? {
              rowCount: record.queryResult.numRows,
              columns: record.queryResult.columns,
              firstRow: record.queryResult.rows[0] ?? {},
            }
          : null,
        check: record.check,
      };
      }),
    };

    writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nWrote results to ${outputPath}`);

    return report.summary.failed + report.summary.errored > 0 ? 1 : 0;
  } catch (error) {
    console.error(`Benchmark failed: ${(error as Error).message}`);
    return 1;
  } finally {
    await runner.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli().then((code) => {
    process.exit(code);
  });
}
