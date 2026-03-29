import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '..');
const BENCHMARKS_DIR = join(ROOT, 'data', 'benchmarks');
const LOGS_DIR = join(ROOT, 'data', 'logs');

// Read benchmark files and extract slugs
const benchmarkFiles = readdirSync(BENCHMARKS_DIR)
  .filter((f) => f.startsWith('benchmark-') && f.endsWith('.json'));

const benchmarkSlugs = new Set(
  benchmarkFiles.map((f) => f.replace(/^benchmark-/, '').replace(/\.json$/, ''))
);

// Read log files and extract slugs
let logFiles: string[] = [];
try {
  logFiles = readdirSync(LOGS_DIR)
    .filter((f) => f.startsWith('benchmark-') && f.endsWith('.jsonl'));
} catch {
  // logs/ dir may not exist
}

const logsBySlug = new Map<string, string[]>();
for (const f of logFiles) {
  const slug = f.replace(/^benchmark-/, '').replace(/-\d{8}T\d{6}Z\.jsonl$/, '');
  if (!logsBySlug.has(slug)) logsBySlug.set(slug, []);
  logsBySlug.get(slug)!.push(f);
}
const logSlugs = new Set(logsBySlug.keys());

// Find mismatches
const benchmarksWithoutLogs = [...benchmarkSlugs].filter((s) => !logSlugs.has(s));
const logsWithoutBenchmarks = [...logSlugs].filter((s) => !benchmarkSlugs.has(s));

let hasIssues = false;

if (benchmarksWithoutLogs.length > 0) {
  hasIssues = true;
  console.log('Benchmarks without matching log files:');
  for (const slug of benchmarksWithoutLogs) {
    console.log(`  ${join(BENCHMARKS_DIR, `benchmark-${slug}.json`)}`);
  }
}

for (const [slug, files] of logsBySlug) {
  if (files.length > 1) {
    hasIssues = true;
    const sorted = [...files].sort();
    const selected = sorted[sorted.length - 1];
    console.log(`Multiple log files for benchmark "${slug}" (latest will be used):`);
    for (const f of files) {
      console.log(`  ${f === selected ? '*' : ' '} ${join(LOGS_DIR, f)}`);
    }
  }
}

if (logsWithoutBenchmarks.length > 0) {
  hasIssues = true;
  console.log('Log files without matching benchmarks:');
  for (const slug of logsWithoutBenchmarks) {
    const file = logFiles.find((f) => f.startsWith(`benchmark-${slug}-`));
    console.log(`  ${join(LOGS_DIR, file!)}`);
  }
}

if (!hasIssues) {
  console.log(`All matched: ${benchmarkSlugs.size} benchmarks, ${logSlugs.size} logs`);
}
