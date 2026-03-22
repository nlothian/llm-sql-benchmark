import duckdb from 'duckdb';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const QUESTIONS_PATH = join(ROOT, 'packages', 'data-adventureworks', 'questions.json');
const ASSETS_DIR = join(ROOT, 'packages', 'data-adventureworks', 'assets');
const OUTPUT_DIR = join(ROOT, 'site', 'public', 'data');
const OUTPUT_PATH = join(OUTPUT_DIR, 'answers.json');

function dbAll(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbRun(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function serializeValue(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'bigint') return Number(val);
  if (val instanceof Date) return val.toISOString();
  return val;
}

async function main() {
  const data = JSON.parse(readFileSync(QUESTIONS_PATH, 'utf-8'));
  const { questions, registertables } = data;

  const db = new duckdb.Database(':memory:');

  // Register tables — rewrite CSV paths to absolute
  for (const sql of registertables) {
    const rewritten = sql.replace(
      /read_csv_auto\('([^']+)'\)/g,
      (_match, p) => `read_csv_auto('${join(ASSETS_DIR, p).replace(/'/g, "''")}')`
    );
    await dbRun(db, rewritten);
  }

  console.log(`Loaded ${registertables.length} tables`);

  const output = [];

  for (const q of questions) {
    try {
      const rows = await dbAll(db, q.sql);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : q.columns;
      const serializedRows = rows.map(row => columns.map(col => serializeValue(row[col])));

      output.push({
        id: q.id,
        question: q.question,
        difficulty: q.difficulty,
        sql: q.sql,
        included_tables: q.included_tables,
        columns,
        rows: serializedRows,
        rowCount: serializedRows.length,
      });
      console.log(`  Q${q.id}: ${serializedRows.length} rows`);
    } catch (err) {
      console.error(`  Q${q.id}: ERROR — ${err.message}`);
      output.push({
        id: q.id,
        question: q.question,
        difficulty: q.difficulty,
        sql: q.sql,
        included_tables: q.included_tables,
        columns: q.columns,
        rows: [],
        rowCount: 0,
        error: err.message,
      });
    }
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify({ questions: output }, null, 2));
  console.log(`\nWrote ${OUTPUT_PATH} (${output.length} questions)`);

  await new Promise((resolve, reject) => {
    db.close((err) => { if (err) reject(err); else resolve(); });
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
