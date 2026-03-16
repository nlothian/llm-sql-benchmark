import duckdb from 'duckdb';
import type { BenchmarkDataset, BenchmarkSqlRunner, ColumnCategory, QueryResult, SchemaTable } from '@fifthvertex/benchmark-core';

type TablePathResolver = (tableFile: string) => string;

function dbAll(db: duckdb.Database, sql: string): Promise<duckdb.TableData> {
  return new Promise((resolve, reject) => {
    db.all(sql, (err: Error | null, rows: duckdb.TableData) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbRun(db: duckdb.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function escapeSqlPath(path: string): string {
  return path.replace(/'/g, "''");
}

function extractCreatedObjectName(sql: string): string | null {
  const match = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:VIEW|TABLE)\s+"?([\w-]+)"?/i);
  return match ? match[1] : null;
}

function toColumnCategory(value: unknown): ColumnCategory {
  if (typeof value === 'number' || typeof value === 'bigint') return 'numeric';
  if (typeof value === 'boolean') return 'boolean';
  if (value instanceof Date) return 'date';
  if (value === null || value === undefined) return 'other';
  return 'text';
}

export class NodeDuckDbRunner implements BenchmarkSqlRunner {
  private db: duckdb.Database;
  private resolveTablePath: TablePathResolver;

  private constructor(db: duckdb.Database, resolveTablePath: TablePathResolver) {
    this.db = db;
    this.resolveTablePath = resolveTablePath;
  }

  static async create(resolveTablePath: TablePathResolver): Promise<NodeDuckDbRunner> {
    return new NodeDuckDbRunner(new duckdb.Database(':memory:'), resolveTablePath);
  }

  async loadDataset(dataset: BenchmarkDataset): Promise<void> {
    for (const sql of dataset.registerTables) {
      const rewritten = sql.replace(
        /read_csv_auto\('([^']+)'\)/g,
        (_match, p: string) => `read_csv_auto('${escapeSqlPath(this.resolveTablePath(p))}')`,
      );

      const objectName = extractCreatedObjectName(sql);
      if (objectName) {
        await dbRun(this.db, `DROP VIEW IF EXISTS "${objectName}"`);
        await dbRun(this.db, `DROP TABLE IF EXISTS "${objectName}"`);
      }
      await dbRun(this.db, rewritten);
    }
  }

  async getSchema(): Promise<SchemaTable> {
    const rows = await dbAll(
      this.db,
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'main'
       ORDER BY table_name, ordinal_position`,
    ) as Array<{ table_name: string; column_name: string; data_type: string }>;

    const schema: SchemaTable = {};
    for (const row of rows) {
      if (!schema[row.table_name]) schema[row.table_name] = [];
      schema[row.table_name].push({ col: row.column_name, type: row.data_type });
    }
    return schema;
  }

  async runQuery(sql: string): Promise<QueryResult> {
    const start = performance.now();
    const rows = await dbAll(this.db, sql) as Array<Record<string, unknown>>;
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);

    if (rows.length === 0) {
      return { columns: [], columnTypes: {}, rows: [], numRows: 0, elapsed };
    }

    const columns = Object.keys(rows[0]);
    const columnTypes: Record<string, ColumnCategory> = {};
    for (const col of columns) {
      columnTypes[col] = toColumnCategory(rows[0][col]);
    }

    const stringRows = rows.map(row => {
      const normalized: Record<string, string | null> = {};
      for (const col of columns) {
        const value = row[col];
        normalized[col] = value === null || value === undefined ? null : String(value);
      }
      return normalized;
    });

    return {
      columns,
      columnTypes,
      rows: stringRows,
      numRows: stringRows.length,
      elapsed,
    };
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
