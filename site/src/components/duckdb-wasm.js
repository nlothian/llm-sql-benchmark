import * as duckdb from "@duckdb/duckdb-wasm";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import { fetchGz } from "./fetchGz.js";

let dbPromise = null;
const loadedTables = new Set();

async function initDB() {
  const cdnBundles = duckdb.getJsDelivrBundles();
  const bundles = {
    ...cdnBundles,
    mvp: { ...cdnBundles.mvp, mainWorker: mvpWorker },
    eh: { ...cdnBundles.eh, mainWorker: ehWorker },
  };
  const bundle = await duckdb.selectBundle(bundles);
  const worker = new Worker(bundle.mainWorker);
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  return db;
}

export function getDB() {
  if (!dbPromise) {
    dbPromise = initDB();
  }
  return dbPromise;
}

export async function ensureTablesLoaded(db, tableNames) {
  for (const name of tableNames) {
    if (loadedTables.has(name)) continue;
    const resp = await fetchGz(`/data/tables/${name}.csv`);
    const buf = await resp.arrayBuffer();
    await db.registerFileBuffer(`${name}.csv`, new Uint8Array(buf));
    const conn = await db.connect();
    try {
      await conn.query(`CREATE VIEW ${name} AS SELECT * FROM read_csv_auto('${name}.csv')`);
    } finally {
      await conn.close();
    }
    loadedTables.add(name);
  }
}

export async function runSQL(db, sql) {
  const conn = await db.connect();
  try {
    const start = performance.now();
    const result = await conn.query(sql);
    const elapsed = performance.now() - start;
    const columns = result.schema.fields.map((f) => f.name);
    const rows = result.toArray().map((row) => columns.map((col) => row[col]));
    return { columns, rows, numRows: rows.length, elapsed };
  } finally {
    await conn.close();
  }
}
