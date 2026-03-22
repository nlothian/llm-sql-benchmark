import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const BENCHMARKS_DIR = join(ROOT, 'benchmarks');
const QUESTIONS_PATH = join(ROOT, 'packages', 'data-adventureworks', 'questions.json');

// Load questions keyed by id
const questionsRaw = JSON.parse(readFileSync(QUESTIONS_PATH, 'utf-8'));
const questionsById = new Map(questionsRaw.questions.map(q => [q.id, q]));

// --- Check logic (mirrors packages/core/src/check.ts) ---

function normalizeCol(c) {
  return c.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function checkResult(question, result) {
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

  const actualColsNorm = new Map(result.columns.map(c => [normalizeCol(c), c]));
  const expectedColsNorm = new Map(question.columns.map(c => [normalizeCol(c), c]));

  const missingColumns = question.columns.filter(c => !actualColsNorm.has(normalizeCol(c)));
  const extraColumns = result.columns.filter(c => !expectedColsNorm.has(normalizeCol(c)));

  const rowCountMatch = result.numRows === question.row_count;
  const columnCountMatch = result.columns.length === question.columns.length;
  const columnNamesMatch = missingColumns.length === 0 && extraColumns.length === 0;

  const firstRowDiffs = [];
  const firstRow = result.rows?.[0];
  if (firstRow) {
    for (const col of question.columns) {
      if (!(col in question.first_row)) continue;

      const expected = question.first_row[col];
      const actualColName = actualColsNorm.get(normalizeCol(col));
      if (!actualColName) continue;
      const actual = firstRow[actualColName];

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
    firstRowMatch: firstRowDiffs.length === 0 && firstRow != null,
    actualRowCount: result.numRows,
    actualColumnCount: result.columns.length,
    missingColumns,
    extraColumns,
    firstRowDiffs,
  };
}

function isPass(check) {
  return check.rowCountMatch && check.columnCountMatch && check.columnNamesMatch && check.firstRowMatch;
}

// --- Main ---

const benchmarkFiles = readdirSync(BENCHMARKS_DIR)
  .filter(f => f.startsWith('benchmark-') && f.endsWith('.json'));

let totalChanged = 0;

for (const bf of benchmarkFiles) {
  const filePath = join(BENCHMARKS_DIR, bf);
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  let changed = false;

  for (const r of data.results) {
    if (r.status === 'error') continue;

    const question = questionsById.get(r.id);
    if (!question) {
      console.warn(`  Warning: no question found for id ${r.id} in ${bf}`);
      continue;
    }

    // Reconstruct QueryResult from stored result
    const storedResult = r.result;
    if (!storedResult) continue;

    const queryResult = {
      columns: storedResult.columns,
      numRows: storedResult.rowCount,
      rows: storedResult.firstRow ? [storedResult.firstRow] : [],
    };

    const newCheck = checkResult(
      { columns: question.columns, row_count: question.row_count, first_row: question.first_row },
      queryResult,
    );
    const newStatus = r.error ? 'error' : (isPass(newCheck) ? 'pass' : 'fail');

    if (r.status !== newStatus) {
      console.log(`  ${bf}: Q${r.id} ${r.status} → ${newStatus}`);
      changed = true;
    }

    r.check = newCheck;
    r.status = newStatus;
  }

  // Recalculate summary
  const passed = data.results.filter(r => r.status === 'pass').length;
  const failed = data.results.filter(r => r.status === 'fail').length;
  const errored = data.results.filter(r => r.status === 'error').length;

  if (data.summary.passed !== passed || data.summary.failed !== failed || data.summary.errored !== errored) {
    changed = true;
  }

  data.summary.passed = passed;
  data.summary.failed = failed;
  data.summary.errored = errored;

  if (changed) {
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    totalChanged++;
    console.log(`  Updated ${bf} (${passed}/${data.summary.total} passed)`);
  }
}

console.log(`\nDone. ${totalChanged} benchmark file(s) updated.`);
