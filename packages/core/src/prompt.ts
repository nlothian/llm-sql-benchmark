import type { BenchmarkToolDefinition, QueryResult, SchemaTable } from './types';

export const RUN_SQL_QUERY_TOOL: BenchmarkToolDefinition = {
  name: 'run_sql_query',
  description: 'Execute a SQL query against the DuckDB database. Call this when you have a SQL query ready to run.',
  parameters: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'The DuckDB SQL query to execute. ONLY ever pass SQL to this' },
    },
    required: ['sql'],
  },
};

export const RESULTS_OK_TOOL: BenchmarkToolDefinition = {
  name: 'results_ok',
  description: 'Confirm that the query results correctly answer the user question. Call this when the results look correct.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const BENCHMARK_TOOLS = [RUN_SQL_QUERY_TOOL, RESULTS_OK_TOOL] as const;

export function buildSchemaText(schema: SchemaTable): string {
  const entries = Object.entries(schema);
  if (entries.length === 0) {
    return 'No tables exist yet.';
  }

  const lines = ['Available tables:\n'];
  for (const [tableName, columns] of entries) {
    const colList = columns.map(c => `${c.col} (${c.type})`).join(', ');
    lines.push(`Table "${tableName}":`);
    lines.push(`  Columns: ${colList}\n`);
  }
  return lines.join('\n');
}

export function buildToolSystemPrompt(schema: SchemaTable): string {
  return `You are a SQL query generator for DuckDB.
Generate SQL queries that answer the user's questions using DuckDB SQL syntax.
Make sure you quote all field, column and table names.
Think through the problem step by step before writing the query.

Here is the database schema:

${buildSchemaText(schema)}

You have these tools available: run_sql_query(sql) - Execute a SQL query against the DuckDB database.

Workflow:
- Call run_sql_query with your SQL query. Important: only ever pass SQL to run_sql_query.
- If the query returns an error, call run_sql_query with a corrected query.
- When results look correct, call results_ok.`;
}

export function buildGrammarSystemPrompt(schema: SchemaTable): string {
  return `You are a SQL query generator for DuckDB.
Generate SQL queries that answer the user's questions using DuckDB SQL syntax.
Make sure you quote all field, column and table names.

Here is the database schema:

${buildSchemaText(schema)}

Instructions:
- Output a SQL SELECT query that answers the question.
- Do not output anything other than the SQL query`;
}

export function buildResultSummary(result: QueryResult, mode: 'tool' | 'grammar' = 'tool'): string {
  const firstRow = result.rows[0];
  const firstRowStr = firstRow
    ? result.columns.map(c => `${c}=${firstRow[c] ?? 'NULL'}`).join(', ')
    : '(empty)';

  const instructions = mode === 'grammar'
    ? `If they do, output OK
If they do not, output a corrected SQL query.
Do not output anything other than the SQL query or OK.`
    : `If they do, call results_ok.
If they do not, call run_sql_query with a corrected query.`;

  return `Query executed successfully. Verify these results match the request.

${instructions}

Returned ${result.numRows} row(s).
Columns: ${result.columns.join(', ')}
First row: ${firstRowStr}`;
}

export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
