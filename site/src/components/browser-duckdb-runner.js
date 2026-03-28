import { getDB, ensureTablesLoaded, runSQL } from "./duckdb-wasm.js";

const ALL_TABLES = [
  "Customer",
  "Date",
  "Product",
  "Reseller",
  "Sales",
  "Sales_Order",
  "Sales_Territory",
];

function toColumnCategory(value) {
  if (typeof value === "number" || typeof value === "bigint") return "numeric";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof Date) return "date";
  if (value === null || value === undefined) return "other";
  return "text";
}

export class BrowserDuckDbRunner {
  constructor(db) {
    this.db = db;
  }

  static async create() {
    const db = await getDB();
    return new BrowserDuckDbRunner(db);
  }

  async loadDataset(_dataset) {
    await ensureTablesLoaded(this.db, ALL_TABLES);
  }

  async getSchema() {
    const result = await runSQL(
      this.db,
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'main'
       ORDER BY table_name, ordinal_position`
    );
    const schema = {};
    for (const row of result.rows) {
      const tableName = row[0];
      const columnName = row[1];
      const dataType = row[2];
      if (!schema[tableName]) schema[tableName] = [];
      schema[tableName].push({ col: columnName, type: dataType });
    }
    return schema;
  }

  async runQuery(sql) {
    const start = performance.now();
    const result = await runSQL(this.db, sql);
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);

    if (result.numRows === 0) {
      return { columns: result.columns, columnTypes: {}, rows: [], numRows: 0, elapsed };
    }

    const columns = result.columns;
    const columnTypes = {};
    const firstRow = result.rows[0];
    for (let i = 0; i < columns.length; i++) {
      columnTypes[columns[i]] = toColumnCategory(firstRow[i]);
    }

    const stringRows = result.rows.map((row) => {
      const normalized = {};
      for (let i = 0; i < columns.length; i++) {
        const value = row[i];
        normalized[columns[i]] = value === null || value === undefined ? null : String(value);
      }
      return normalized;
    });

    return { columns, columnTypes, rows: stringRows, numRows: stringRows.length, elapsed };
  }

  async close() {
    // No-op: singleton DB is shared with other components
  }
}
