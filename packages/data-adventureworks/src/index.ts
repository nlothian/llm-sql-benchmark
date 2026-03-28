import type { BenchmarkDataset, BenchmarkDifficulty, BenchmarkQuestion } from '@fifthvertex/benchmark-core';
import {
  BENCHMARK_CATEGORIES,
  BENCHMARK_QUESTIONS,
  BENCHMARK_REGISTER_TABLES,
  BENCHMARK_TABLE_FILES,
} from './generated/manifest';

export const benchmarkDataset: BenchmarkDataset = {
  id: 'adventureworks',
  name: 'AdventureWorks Benchmark',
  questions: BENCHMARK_QUESTIONS as unknown as BenchmarkQuestion[],
  registerTables: BENCHMARK_REGISTER_TABLES,
  tableFiles: BENCHMARK_TABLE_FILES,
};

export const benchmarkCategories = BENCHMARK_CATEGORIES as Record<BenchmarkDifficulty, { description: string }>;

export {
  BENCHMARK_CATEGORIES,
  BENCHMARK_QUESTIONS,
  BENCHMARK_REGISTER_TABLES,
  BENCHMARK_TABLE_FILES,
};
