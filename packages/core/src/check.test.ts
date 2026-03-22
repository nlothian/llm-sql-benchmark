import { describe, expect, it } from 'vitest';
import { checkBenchmarkResult, isBenchmarkPass } from './check';
import type { QueryResult } from './types';

const baseQuestion = {
  columns: ['Fiscal Year', 'gross_margin_pct'],
  row_count: 1,
  first_row: { 'Fiscal Year': 'FY2018', gross_margin_pct: 12.7 },
};

function makeResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: ['Fiscal_Year', 'Gross Margin Pct'],
    columnTypes: { Fiscal_Year: 'text', 'Gross Margin Pct': 'numeric' },
    rows: [{ Fiscal_Year: 'FY2018', 'Gross Margin Pct': '12.7' }],
    numRows: 1,
    elapsed: '0.01',
    ...overrides,
  };
}

describe('checkBenchmarkResult', () => {
  it('matches normalized column names and numeric precision', () => {
    const result = checkBenchmarkResult(baseQuestion, makeResult());
    expect(isBenchmarkPass(result)).toBe(true);
  });

  it('accepts double-rounded values within tolerance (4643.45 matches expected 4643.4)', () => {
    const q = { columns: ['yoy_growth_pct'], row_count: 1, first_row: { yoy_growth_pct: 4643.4 } };
    const result = checkBenchmarkResult(q, makeResult({
      columns: ['yoy_growth_pct'],
      rows: [{ yoy_growth_pct: '4643.45' }],
      numRows: 1,
    }));
    expect(result.firstRowMatch).toBe(true);
    expect(result.firstRowDiffs).toHaveLength(0);
  });

  it('rejects values outside tolerance (4643.5 does not match expected 4643.4)', () => {
    const q = { columns: ['yoy_growth_pct'], row_count: 1, first_row: { yoy_growth_pct: 4643.4 } };
    const result = checkBenchmarkResult(q, makeResult({
      columns: ['yoy_growth_pct'],
      rows: [{ yoy_growth_pct: '4643.5' }],
      numRows: 1,
    }));
    expect(result.firstRowMatch).toBe(false);
    expect(result.firstRowDiffs).toHaveLength(1);
  });

  it('accepts integer values within tolerance (1322.4 matches expected 1322)', () => {
    const q = { columns: ['count'], row_count: 1, first_row: { count: 1322 } };
    const result = checkBenchmarkResult(q, makeResult({
      columns: ['count'],
      rows: [{ count: '1322.4' }],
      numRows: 1,
    }));
    expect(result.firstRowMatch).toBe(true);
  });

  it('rejects integer values outside tolerance (1323 does not match expected 1322)', () => {
    const q = { columns: ['count'], row_count: 1, first_row: { count: 1322 } };
    const result = checkBenchmarkResult(q, makeResult({
      columns: ['count'],
      rows: [{ count: '1323' }],
      numRows: 1,
    }));
    expect(result.firstRowMatch).toBe(false);
  });

  it('reports missing columns and row mismatch', () => {
    const result = checkBenchmarkResult(
      baseQuestion,
      makeResult({
        columns: ['Fiscal_Year'],
        rows: [{ Fiscal_Year: 'FY2018' }],
        numRows: 2,
      }),
    );

    expect(result.rowCountMatch).toBe(false);
    expect(result.columnNamesMatch).toBe(false);
    expect(result.missingColumns).toContain('gross_margin_pct');
  });
});
