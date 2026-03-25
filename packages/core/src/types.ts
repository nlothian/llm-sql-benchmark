export type BenchmarkDifficulty = 'trivial' | 'easy' | 'medium' | 'hard';

export interface SchemaColumn {
  col: string;
  type: string;
}

export interface SchemaTable {
  [tableName: string]: SchemaColumn[];
}

export type ColumnCategory = 'numeric' | 'text' | 'date' | 'boolean' | 'other';

export interface QueryResult {
  columns: string[];
  columnTypes: Record<string, ColumnCategory>;
  rows: Record<string, string | null>[];
  numRows: number;
  elapsed: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cost?: number;
}

export interface BenchmarkQuestion {
  id: number;
  question: string;
  difficulty: BenchmarkDifficulty;
  sql: string;
  included_tables?: readonly string[];
  row_count: number;
  columns: readonly string[];
  first_row: Record<string, unknown>;
}

export interface BenchmarkDataset {
  id: string;
  name: string;
  questions: BenchmarkQuestion[];
  registerTables: string[];
  tableFiles: string[];
}

export interface BenchmarkToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export type BenchmarkConversationMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      toolCall: { id: string; name: string; arguments: Record<string, unknown> };
      thoughtSignature?: string;
    }
  | { role: 'tool_result'; toolCallId: string; content: string };

export interface BenchmarkToolCallResponse {
  toolCallId: string;
  functionName: string;
  arguments: Record<string, unknown>;
  thinking?: string;
  thoughtSignature?: string;
}

export interface ToolCallingClientCallOptions {
  systemPrompt: string;
  messages: BenchmarkConversationMessage[];
  tools: BenchmarkToolDefinition[];
  abortSignal?: AbortSignal;
  onTokenUsage?: (usage: TokenUsage) => void;
  onModelName?: (name: string) => void;
  onClientCallAttempt?: () => void;
}

export interface GrammarClientGenerateOptions {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  grammar: string;
  abortSignal?: AbortSignal;
  onTokenUsage?: (usage: TokenUsage) => void;
  onModelName?: (name: string) => void;
}

export interface ToolCallingBenchmarkClient {
  mode: 'tool-calling';
  call(options: ToolCallingClientCallOptions): Promise<BenchmarkToolCallResponse>;
}

export interface GrammarBenchmarkClient {
  mode: 'grammar';
  generate(options: GrammarClientGenerateOptions): Promise<{ text: string }>;
}

export type BenchmarkClient = ToolCallingBenchmarkClient | GrammarBenchmarkClient;

export interface BenchmarkSqlRunner {
  loadDataset(dataset: BenchmarkDataset): Promise<void>;
  getSchema(): Promise<SchemaTable>;
  runQuery(sql: string): Promise<QueryResult>;
  close?(): Promise<void>;
}

export interface BenchmarkCheckQuestion {
  columns: readonly string[];
  row_count: number;
  first_row: Record<string, unknown>;
}

export interface BenchmarkCheckResult {
  rowCountMatch: boolean;
  columnCountMatch: boolean;
  columnNamesMatch: boolean;
  firstRowMatch: boolean;
  actualRowCount: number | null;
  actualColumnCount: number | null;
  missingColumns: string[];
  extraColumns: string[];
  firstRowDiffs: Array<{ column: string; expected: unknown; actual: unknown }>;
}

export interface BenchmarkRunRecord {
  question: BenchmarkQuestion;
  generatedSql: string | null;
  queryResult: QueryResult | null;
  error: string | null;
  check: BenchmarkCheckResult | null;
  durationMs: number | null;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  status: 'pass' | 'fail' | 'error';
}

export interface BenchmarkSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number | null;
}

export interface BenchmarkReport {
  meta: {
    datasetId: string;
    datasetName: string;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    modelName: string | null;
    aborted: boolean;
    weightsAvailable?: 'open' | 'closed';
  };
  summary: BenchmarkSummary;
  results: BenchmarkRunRecord[];
}

export type BenchmarkEvent =
  | { type: 'run-started'; totalQuestions: number; startedAt: string }
  | { type: 'dataset-loaded' }
  | { type: 'question-started'; index: number; total: number; question: BenchmarkQuestion }
  | { type: 'question-completed'; index: number; total: number; record: BenchmarkRunRecord }
  | { type: 'status'; message: string; questionId?: number }
  | { type: 'run-completed'; report: BenchmarkReport }
  | { type: 'run-aborted'; report: BenchmarkReport };

export interface RunBenchmarkOptions {
  dataset: BenchmarkDataset;
  runner: BenchmarkSqlRunner;
  client: BenchmarkClient;
  difficulties?: BenchmarkDifficulty[];
  questionIds?: number[];
  timeoutMs?: number;
  maxRetries?: number;
  grammar?: string;
  abortSignal?: AbortSignal;
  onEvent?: (event: BenchmarkEvent) => void;
}
