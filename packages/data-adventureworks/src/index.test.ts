// @vitest-environment node
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_TABLE_FILES,
  benchmarkDataset,
  getBrowserTableUrl,
  getNodeTablePath,
} from './index';

describe('adventureworks dataset package', () => {
  it('exposes dataset metadata and questions', () => {
    expect(benchmarkDataset.id).toBe('adventureworks');
    expect(benchmarkDataset.questions.length).toBeGreaterThan(0);
    expect(benchmarkDataset.tableFiles.length).toBe(BENCHMARK_TABLE_FILES.length);
  });

  it('resolves every table file in browser and node forms', () => {
    for (const tableFile of BENCHMARK_TABLE_FILES) {
      const browserUrl = getBrowserTableUrl(tableFile);
      const nodePath = getNodeTablePath(tableFile);

      expect(browserUrl).toContain('tables/');
      expect(nodePath).toContain('/tables/');
      expect(existsSync(nodePath)).toBe(true);
    }
  });
});
