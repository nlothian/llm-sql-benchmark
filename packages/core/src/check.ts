import type { BenchmarkCheckQuestion, BenchmarkCheckResult, QueryResult } from './types';

export function checkBenchmarkResult(
  question: BenchmarkCheckQuestion,
  result: QueryResult | null,
): BenchmarkCheckResult {
  if (!result) {
    return {
      rowCountMatch: false,
      columnCountMatch: false,
      columnNamesMatch: false,
      firstRowMatch: false,
      actualRowCount: null,
      actualColumnCount: null,
      missingColumns: [...question.columns],
      extraColumns: [],
      firstRowDiffs: [],
    };
  }

  // Normalize so "Fiscal Year", "fiscal_year", and "FiscalYear" match.
  const normalizeCol = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, '');

  const actualColsNorm = new Map(result.columns.map(c => [normalizeCol(c), c]));
  const expectedColsNorm = new Map(question.columns.map(c => [normalizeCol(c), c]));

  const missingColumns = question.columns.filter(c => !actualColsNorm.has(normalizeCol(c)));
  const extraColumns = result.columns.filter(c => !expectedColsNorm.has(normalizeCol(c)));

  const rowCountMatch = result.numRows === question.row_count;
  const columnCountMatch = result.columns.length === question.columns.length;
  const columnNamesMatch = missingColumns.length === 0 && extraColumns.length === 0;

  const firstRowDiffs: Array<{ column: string; expected: unknown; actual: unknown }> = [];
  if (result.rows.length > 0) {
    const firstRow = result.rows[0];
    for (const col of question.columns) {
      if (!(col in question.first_row)) continue;

      const expected = question.first_row[col];
      const actualColName = actualColsNorm.get(normalizeCol(col));
      if (!actualColName) continue;
      const actual = firstRow[actualColName];

      // Numeric comparison rounds actual to expected precision.
      const expectedNum = Number(expected);
      const actualNum = Number(actual);
      let numMatch = false;
      if (!isNaN(expectedNum) && !isNaN(actualNum)) {
        const expectedStr = String(expected);
        const dotIdx = expectedStr.indexOf('.');
        const decimals = dotIdx === -1 ? 0 : expectedStr.length - dotIdx - 1;
        const tolerance = 5 * Math.pow(10, -(decimals + 1));
        const epsilon = Number.EPSILON * Math.max(Math.abs(actualNum), Math.abs(expectedNum));
        numMatch = Math.abs(actualNum - expectedNum) <= tolerance + epsilon;
      }

      const strMatch = String(actual) === String(expected);
      if (!numMatch && !strMatch) {
        firstRowDiffs.push({ column: col, expected, actual });
      }
    }
  }

  return {
    rowCountMatch,
    columnCountMatch,
    columnNamesMatch,
    firstRowMatch: firstRowDiffs.length === 0 && result.rows.length > 0,
    actualRowCount: result.numRows,
    actualColumnCount: result.columns.length,
    missingColumns,
    extraColumns,
    firstRowDiffs,
  };
}

export function isBenchmarkPass(check: BenchmarkCheckResult | null): boolean {
  if (!check) return false;
  return check.rowCountMatch && check.columnCountMatch && check.columnNamesMatch && check.firstRowMatch;
}
