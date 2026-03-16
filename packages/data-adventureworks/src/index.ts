import type { BenchmarkDataset, BenchmarkDifficulty, BenchmarkQuestion } from '@fifthvertex/benchmark-core';
import {
  BENCHMARK_CATEGORIES,
  BENCHMARK_QUESTIONS,
  BENCHMARK_REGISTER_TABLES,
  BENCHMARK_TABLE_FILES,
  BENCHMARK_TABLE_URLS,
} from './generated/manifest';

export const benchmarkDataset: BenchmarkDataset = {
  id: 'adventureworks',
  name: 'AdventureWorks Benchmark',
  questions: BENCHMARK_QUESTIONS as unknown as BenchmarkQuestion[],
  registerTables: BENCHMARK_REGISTER_TABLES,
  tableFiles: BENCHMARK_TABLE_FILES,
};

export const benchmarkCategories = BENCHMARK_CATEGORIES as Record<BenchmarkDifficulty, { description: string }>;
const KNOWN_TABLE_FILES = new Set(BENCHMARK_TABLE_FILES);

function normalizeTableFile(name: string): string {
  const trimmed = name.trim().replace(/^\.?\//, '');
  if (trimmed.startsWith('tables/')) {
    return trimmed;
  }
  return `tables/${trimmed}`;
}

function assertTableExists(normalizedPath: string): void {
  if (!KNOWN_TABLE_FILES.has(normalizedPath)) {
    throw new Error(`Unknown benchmark table: ${normalizedPath}`);
  }
}

export function getBrowserTableUrl(name: string): string {
  const normalized = normalizeTableFile(name);
  assertTableExists(normalized);
  return BENCHMARK_TABLE_URLS[normalized].toString();
}

export function getNodeTablePath(name: string): string {
  const normalized = normalizeTableFile(name);
  assertTableExists(normalized);
  const url = BENCHMARK_TABLE_URLS[normalized];
  if (url.protocol !== 'file:') {
    throw new Error(`Expected file URL for ${normalized}, got ${url.protocol}`);
  }
  return decodeURIComponent(url.pathname);
}

export {
  BENCHMARK_CATEGORIES,
  BENCHMARK_QUESTIONS,
  BENCHMARK_REGISTER_TABLES,
  BENCHMARK_TABLE_FILES,
  BENCHMARK_TABLE_URLS,
};
