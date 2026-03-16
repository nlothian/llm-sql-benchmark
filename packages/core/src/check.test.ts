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
