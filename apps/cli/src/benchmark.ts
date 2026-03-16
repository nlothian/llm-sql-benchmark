import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { BenchmarkDataset, BenchmarkDifficulty, BenchmarkQuestion } from '@fifthvertex/benchmark-core';
import { runBenchmark } from '@fifthvertex/benchmark-core';
import { benchmarkDataset as bundledDataset, getNodeTablePath } from '@fifthvertex/benchmark-data-adventureworks';
import { createOpenAiGrammarClient, createOpenAiToolCallingClient } from './client-adapters.ts';
import { NodeDuckDbRunner } from './duckdb-runner.ts';

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
}

function parseCliArgs(argv: string[]): { args: CliArgs | null; exitCode: number } {
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
  --output <path>        Output JSON file (default: benchmark-<model>.json)
  --output-dir <dir>     Directory for default output file (uses default filename)
  --model-variant <tag>  Appended to default output filename
  --reasoning-effort <l> Reasoning effort (xhigh, high, medium, low, minimal, none)
  --grammar              Grammar-constrained mode
  -h, --help             Show this help message`);
    return { args: null, exitCode: 0 };
  }

  if (!values.endpoint) {
    console.error('Error: --endpoint is required');
    return { args: null, exitCode: 1 };
  }
  if (!values.model) {
    console.error('Error: --model is required');
    return { args: null, exitCode: 1 };
  }

  const allowedEfforts: ReasoningEffort[] = ['xhigh', 'high', 'medium', 'low', 'minimal', 'none'];
  const rawEffort = values['reasoning-effort'];
  if (rawEffort && !allowedEfforts.includes(rawEffort as ReasoningEffort)) {
    console.error(`Error: --reasoning-effort must be one of: ${allowedEfforts.join(', ')}`);
    return { args: null, exitCode: 1 };
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
      modelVariant: values['model-variant'],
      reasoningEffort: rawEffort as ReasoningEffort | undefined,
      grammar: values.grammar ?? false,
    },
    exitCode: 0,
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

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: CliArgs;
  try {
    const parsed = parseCliArgs(argv);
    if (!parsed.args) {
      return parsed.exitCode;
    }
    args = parsed.args;
  } catch (error) {
    console.error(`Error parsing arguments: ${(error as Error).message}`);
    return 1;
  }

  const dataset = args.dataDir ? loadDatasetFromDirectory(args.dataDir) : bundledDataset;

  const questionIds = args.questionId !== undefined ? [args.questionId] : undefined;
  const difficulties = mapDifficulties(args.difficulties);

  const runner = await NodeDuckDbRunner.create((tableFile) => {
    if (args.dataDir) {
      const normalized = tableFile.startsWith('tables/') ? tableFile.slice('tables/'.length) : tableFile;
      return resolve(args.dataDir, 'tables', normalized);
    }
    return getNodeTablePath(tableFile);
  });

  const client = args.grammar
    ? createOpenAiGrammarClient({ endpoint: args.endpoint, apiKey: args.apiKey, model: args.model, reasoningEffort: args.reasoningEffort })
    : createOpenAiToolCallingClient({ endpoint: args.endpoint, apiKey: args.apiKey, model: args.model, reasoningEffort: args.reasoningEffort });

  console.log('Benchmark CLI');
  console.log(`  Endpoint: ${args.endpoint}`);
  console.log(`  Model:    ${args.model}`);
  console.log(`  Dataset:  ${dataset.name}`);
  console.log(`  Timeout:  ${args.timeoutSec}s per question`);
  if (args.output) console.log(`  Output:   ${args.output}`);
  if (args.outputDir) console.log(`  Out dir:  ${args.outputDir}`);
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
          process.stdout.write(`[Q${event.question.id}] (${event.question.difficulty}) ${event.question.question.slice(0, 80)}...`);
          return;
        }

        if (event.type === 'question-completed') {
          const { record } = event;
          if (record.status === 'pass') {
            console.log(` PASS (${record.durationMs ?? 0}ms, ${record.attempts} attempt(s))`);
          } else if (record.status === 'fail') {
            console.log(` FAIL (${record.durationMs ?? 0}ms, ${record.attempts} attempt(s))`);
            if (record.check && !record.check.rowCountMatch) {
              console.log(`  Row count: expected ${record.question.row_count}, got ${record.check.actualRowCount}`);
            }
            if (record.check && !record.check.columnNamesMatch) {
              if (record.check.missingColumns.length > 0) console.log(`  Missing columns: ${record.check.missingColumns.join(', ')}`);
              if (record.check.extraColumns.length > 0) console.log(`  Extra columns: ${record.check.extraColumns.join(', ')}`);
            }
            if (record.generatedSql) console.log(`  SQL: ${record.generatedSql}`);
          } else {
            console.log(` ERROR (${record.durationMs ?? 0}ms): ${record.error}`);
            if (record.generatedSql) console.log(`  Last SQL: ${record.generatedSql}`);
          }
          console.log();
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

    const modelSlug = (report.meta.modelName ?? args.model).replace(/[^a-zA-Z0-9._-]/g, '_');
    const variantSuffix = args.modelVariant ? `-${args.modelVariant.replace(/[^a-zA-Z0-9._-]/g, '_')}` : '';
    const defaultFilename = `benchmark-${modelSlug}${variantSuffix}.json`;
    if (args.outputDir) mkdirSync(args.outputDir, { recursive: true });
    const outputPath = args.output ?? (args.outputDir ? join(args.outputDir, defaultFilename) : defaultFilename);

    const output = {
      meta: {
        endpoint: args.endpoint,
        model: report.meta.modelName ?? args.model,
        ...(args.modelVariant ? { modelVariant: args.modelVariant } : {}),
        timestamp: new Date().toISOString(),
        timeoutSec: args.timeoutSec,
        datasetId: report.meta.datasetId,
        datasetName: report.meta.datasetName,
        aborted: report.meta.aborted,
      },
      summary: report.summary,
      results: report.results.map(record => ({
        id: record.question.id,
        question: record.question.question,
        difficulty: record.question.difficulty,
        status: record.status,
        durationMs: record.durationMs,
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
      })),
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
