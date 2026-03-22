import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface BenchmarkMeta {
  model: string;
  endpoint?: string;
  timestamp?: string;
  throttleTimeSec?: number;
  modelVariant?: string;
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

const ROOT = join(import.meta.dirname!, '..');
const OUT_DIR = join(ROOT, 'site', 'public', 'data');
const BENCHMARKS_DIR = join(OUT_DIR, 'benchmarks');
const LOGS_DIR = join(OUT_DIR, 'logs');

// Read benchmark files
const benchmarkFiles = readdirSync(BENCHMARKS_DIR)
  .filter((f) => f.startsWith('benchmark-') && f.endsWith('.json'));

// Read log files
let logFiles: string[] = [];
try {
  logFiles = readdirSync(LOGS_DIR)
    .filter((f) => f.startsWith('benchmark-') && f.endsWith('.jsonl'));
} catch {
  // logs/ dir may not exist
}

function getSlug(benchmarkFilename: string): string {
  return benchmarkFilename.replace(/^benchmark-/, '').replace(/\.json$/, '');
}

function findLogFile(slug: string): string | null {
  return logFiles.find((f) => f.startsWith(`benchmark-${slug}-`)) || null;
}

const index: { benchmarks: Record<string, unknown>[] } = { benchmarks: [] };

for (const bf of benchmarkFiles) {
  const slug = getSlug(bf);
  const logFile = findLogFile(slug);

  const raw = readFileSync(join(BENCHMARKS_DIR, bf), 'utf-8');
  const data: BenchmarkFile = JSON.parse(raw);

  index.benchmarks.push({
    id: slug,
    benchmarkFile: bf,
    logFile,
    model: data.meta?.model || slug,
    endpoint: data.meta?.endpoint || '',
    timestamp: data.meta?.timestamp || '',
    ...(data.meta?.throttleTimeSec != null ? { throttleTimeSec: data.meta.throttleTimeSec } : {}),
    ...(data.meta?.modelVariant ? { modelVariant: data.meta.modelVariant } : {}),
    total: data.summary?.total || 0,
    passed: data.summary?.passed || 0,
    failed: data.summary?.failed || 0,
    errored: data.summary?.errored || 0,
    totalInputTokens: data.summary?.totalInputTokens || 0,
    totalOutputTokens: data.summary?.totalOutputTokens || 0,
    totalCost: data.summary?.totalCost ?? null,
    results: data.results.map((r) => ({
      id: r.id,
      question: r.question,
      difficulty: r.difficulty,
      status: r.status,
      durationMs: r.durationMs,
      attempts: r.attempts,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cost: r.cost ?? null,
    })),
  });
}

// Sort alphabetically by model name
index.benchmarks.sort((a, b) =>
  (a.model as string).localeCompare(b.model as string)
);

writeFileSync(
  join(OUT_DIR, 'index.json'),
  JSON.stringify(index, null, 2),
  'utf-8'
);
console.log(
  `Wrote ${join(OUT_DIR, 'index.json')} (${index.benchmarks.length} benchmarks, ${index.benchmarks.filter((b) => b.logFile).length} with logs)`
);
