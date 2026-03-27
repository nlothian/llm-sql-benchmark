import * as duckdb from "@duckdb/duckdb-wasm";

let dbPromise = null;
const loadedTables = new Set();

async function initDB() {
  const bundles = {
    mvp: {
      mainModule: "/duckdb/duckdb-mvp.wasm",
      mainWorker: "/duckdb/duckdb-browser-mvp.worker.js",
    },
    eh: {
      mainModule: "/duckdb/duckdb-eh.wasm",
      mainWorker: "/duckdb/duckdb-browser-eh.worker.js",
    },
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
    const resp = await fetch(`/data/tables/${name}.csv`);
    if (!resp.ok) throw new Error(`Failed to fetch table ${name}: ${resp.status}`);
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
