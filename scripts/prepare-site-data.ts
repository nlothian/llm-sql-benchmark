import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

interface BenchmarkMeta {
  model: string;
  endpoint?: string;
  timestamp?: string;
  throttleTimeSec?: number;
  modelVariant?: string;
  weightsAvailable?: 'open' | 'closed';
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

function writeGzipped(filePath: string, data: string | Buffer): void {
  const input = typeof data === 'string' ? Buffer.from(data) : data;
  const compressed = gzipSync(input, { level: 9 });
  writeFileSync(filePath, compressed);
  const ratio = ((1 - compressed.length / input.length) * 100).toFixed(0);
  console.log(`  ${filePath} (${input.length} → ${compressed.length} bytes, ${ratio}% smaller)`);
}

const ROOT = join(import.meta.dirname!, '..');
const OUT_DIR = join(ROOT, 'site', 'public', 'data');

// Source directories (source of truth, git-tracked)
const BENCHMARKS_SRC = join(ROOT, 'data', 'benchmarks');
const LOGS_SRC = join(ROOT, 'data', 'logs');
const CSV_SRC = join(ROOT, 'packages', 'data-adventureworks', 'assets', 'tables');

// Output directories (compressed build artifacts)
const BENCHMARKS_DST = join(OUT_DIR, 'benchmarks');
const LOGS_DST = join(OUT_DIR, 'logs');
const CSV_DST = join(OUT_DIR, 'tables');

mkdirSync(BENCHMARKS_DST, { recursive: true });
mkdirSync(LOGS_DST, { recursive: true });
mkdirSync(CSV_DST, { recursive: true });

// --- Compress CSV tables ---
const csvFiles = readdirSync(CSV_SRC).filter((f) => f.endsWith('.csv'));
console.log(`Compressing ${csvFiles.length} CSV tables:`);
for (const f of csvFiles) {
  writeGzipped(join(CSV_DST, `${f}.gz`), readFileSync(join(CSV_SRC, f)));
}

// DuckDB WASM bundles are loaded from jsDelivr CDN at runtime (see site/src/components/duckdb-wasm.js)

// --- Read and compress benchmark files ---
const benchmarkFiles = readdirSync(BENCHMARKS_SRC)
  .filter((f) => f.startsWith('benchmark-') && f.endsWith('.json'));

console.log(`Compressing ${benchmarkFiles.length} benchmark files:`);
for (const f of benchmarkFiles) {
  writeGzipped(join(BENCHMARKS_DST, `${f}.gz`), readFileSync(join(BENCHMARKS_SRC, f)));
}

// --- Read and compress log files ---
let logFiles: string[] = [];
try {
  logFiles = readdirSync(LOGS_SRC)
    .filter((f) => f.startsWith('benchmark-') && f.endsWith('.jsonl'));
} catch {
  // logs/ dir may not exist
}

console.log(`Compressing ${logFiles.length} log files:`);
for (const f of logFiles) {
  writeGzipped(join(LOGS_DST, `${f}.gz`), readFileSync(join(LOGS_SRC, f)));
}

// --- Build index ---
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

  const raw = readFileSync(join(BENCHMARKS_SRC, bf), 'utf-8');
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
    weightsAvailable: data.meta?.weightsAvailable ?? 'open',
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

const indexJson = JSON.stringify(index);
console.log('Compressing index.json:');
writeGzipped(join(OUT_DIR, 'index.json.gz'), indexJson);
console.log(
  `  (${index.benchmarks.length} benchmarks, ${index.benchmarks.filter((b) => b.logFile).length} with logs)`
);
