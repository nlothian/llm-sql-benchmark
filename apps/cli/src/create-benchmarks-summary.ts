import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface BenchmarkMeta {
  model: string;
}

interface BenchmarkSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost?: number | null;
}

interface BenchmarkResult {
  id: number;
  question: string;
  difficulty: string;
  status: string;
  durationMs: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cost?: number | null;
}

interface BenchmarkFile {
  meta: BenchmarkMeta;
  summary: BenchmarkSummary;
  results: BenchmarkResult[];
}

function escapeCsv(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n'))
    return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: npx tsx apps/cli/src/create-benchmarks-summary.ts <directory>');
  process.exit(1);
}

const absDir = resolve(dir);
const files = readdirSync(absDir)
  .filter((f) => f.startsWith('benchmark') && f.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.error(`No benchmark*.json files found in ${absDir}`);
  process.exit(1);
}

const header = [
  'id',
  'question',
  'difficulty',
  'model',
  'status',
  'durationMs',
  'attempts',
  'inputTokens',
  'outputTokens',
  'cost',
  'summary_total',
  'summary_passed',
  'summary_failed',
  'summary_errored',
  'summary_totalInputTokens',
  'summary_totalOutputTokens',
  'summary_totalCost',
];

const rows: string[] = [];
for (const f of files) {
  const data: BenchmarkFile = JSON.parse(readFileSync(join(absDir, f), 'utf8'));
  const model = data.meta.model;
  const s = data.summary;
  for (const r of data.results) {
    rows.push(
      [
        r.id,
        r.question,
        r.difficulty,
        model,
        r.status,
        r.durationMs,
        r.attempts,
        r.inputTokens,
        r.outputTokens,
        r.cost ?? '',
        s.total,
        s.passed,
        s.failed,
        s.errored,
        s.totalInputTokens,
        s.totalOutputTokens,
        s.totalCost ?? '',
      ]
        .map(escapeCsv)
        .join(',')
    );
  }
}

const csv = [header.join(','), ...rows].join('\n') + '\n';
const outPath = join(absDir, 'benchmark-combined.csv');
writeFileSync(outPath, csv);
console.log(`Wrote ${rows.length} rows to ${outPath}`);
