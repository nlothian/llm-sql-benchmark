import { describe, expect, it, vi } from 'vitest';
import { runBenchmark } from './runBenchmark';
import type {
  BenchmarkDataset,
  BenchmarkSqlRunner,
  GrammarBenchmarkClient,
  QueryResult,
  ToolCallingBenchmarkClient,
} from './types';

const DATASET: BenchmarkDataset = {
  id: 'fixture',
  name: 'Fixture Benchmark',
  tableFiles: ['tables/Foo.csv'],
  registerTables: ['CREATE VIEW Foo AS SELECT * FROM read_csv_auto(\'tables/Foo.csv\')'],
  questions: [
    {
      id: 1,
      question: 'How many rows?',
      difficulty: 'easy',
      sql: 'SELECT COUNT(*) AS c FROM Foo',
      included_tables: ['Foo'],
      row_count: 1,
      columns: ['c'],
      first_row: { c: 3 },
    },
    {
      id: 2,
      question: 'What is the max value?',
      difficulty: 'hard',
      sql: 'SELECT MAX(v) AS max_v FROM Foo',
      included_tables: ['Foo'],
      row_count: 1,
      columns: ['max_v'],
      first_row: { max_v: 9 },
    },
  ],
};

const GOOD_COUNT: QueryResult = {
  columns: ['c'],
  columnTypes: { c: 'numeric' },
  rows: [{ c: '3' }],
  numRows: 1,
  elapsed: '0.01',
};

const GOOD_MAX: QueryResult = {
  columns: ['max_v'],
  columnTypes: { max_v: 'numeric' },
  rows: [{ max_v: '9' }],
  numRows: 1,
  elapsed: '0.01',
};

function makeRunner(): BenchmarkSqlRunner & { runQuery: ReturnType<typeof vi.fn> } {
  return {
    loadDataset: vi.fn(async () => {}),
    getSchema: vi.fn(async () => ({ Foo: [{ col: 'v', type: 'INTEGER' }] })),
    runQuery: vi.fn(async (sql: string) => {
      if (sql.includes('COUNT')) return GOOD_COUNT;
      if (sql.includes('MAX')) return GOOD_MAX;
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };
}

describe('runBenchmark', () => {
  it('runs tool-calling mode and filters questions', async () => {
    const runner = makeRunner();

    const responses = [
      { toolCallId: '1', functionName: 'run_sql_query', arguments: { sql: 'SELECT COUNT(*) AS c FROM Foo' } },
      { toolCallId: '2', functionName: 'results_ok', arguments: {} },
    ];
    const client: ToolCallingBenchmarkClient = {
      mode: 'tool-calling',
      call: vi.fn(async () => responses.shift() ?? { toolCallId: 'x', functionName: 'results_ok', arguments: {} }),
    };

    const report = await runBenchmark({
      dataset: DATASET,
      runner,
      client,
      questionIds: [1],
    });

    expect(report.summary.total).toBe(1);
    expect(report.summary.passed).toBe(1);
    expect(report.results[0].status).toBe('pass');
  });

  it('aggregates per-call token usage, cost, and model name into report totals', async () => {
    const runner = makeRunner();
    const responses = [
      { toolCallId: '1', functionName: 'run_sql_query', arguments: { sql: 'SELECT COUNT(*) AS c FROM Foo' } },
      { toolCallId: '2', functionName: 'results_ok', arguments: {} },
    ];

    const client: ToolCallingBenchmarkClient = {
      mode: 'tool-calling',
      call: vi.fn(async ({ onTokenUsage, onModelName }) => {
        onModelName?.('fixture-model');
        if (responses.length === 2) {
          onTokenUsage?.({ inputTokens: 10, outputTokens: 4, cost: 0.001 });
        } else {
          onTokenUsage?.({ inputTokens: 2, outputTokens: 1, cost: 0.0005 });
        }
        return responses.shift() ?? { toolCallId: 'x', functionName: 'results_ok', arguments: {} };
      }),
    };

    const report = await runBenchmark({
      dataset: DATASET,
      runner,
      client,
      questionIds: [1],
    });

    expect(report.meta.modelName).toBe('fixture-model');
    expect(report.summary.totalInputTokens).toBe(12);
    expect(report.summary.totalOutputTokens).toBe(5);
    expect(report.results[0].inputTokens).toBe(12);
    expect(report.results[0].outputTokens).toBe(5);
    expect(report.results[0].cost).toBe(0.0015);
    expect(report.summary.totalCost).toBe(0.0015);
  });

  it('reports cost as null when provider does not include cost', async () => {
    const runner = makeRunner();
    const responses = [
      { toolCallId: '1', functionName: 'run_sql_query', arguments: { sql: 'SELECT COUNT(*) AS c FROM Foo' } },
      { toolCallId: '2', functionName: 'results_ok', arguments: {} },
    ];

    const client: ToolCallingBenchmarkClient = {
      mode: 'tool-calling',
      call: vi.fn(async ({ onTokenUsage }) => {
        onTokenUsage?.({ inputTokens: 5, outputTokens: 2 });
        return responses.shift() ?? { toolCallId: 'x', functionName: 'results_ok', arguments: {} };
      }),
    };

    const report = await runBenchmark({
      dataset: DATASET,
      runner,
      client,
      questionIds: [1],
    });

    expect(report.results[0].cost).toBeNull();
    expect(report.summary.totalCost).toBeNull();
  });

  it('continues after unknown tool calls and eventually passes', async () => {
    const runner = makeRunner();
    const responses = [
      { toolCallId: 'u1', functionName: 'mystery_tool', arguments: {} },
      { toolCallId: '1', functionName: 'run_sql_query', arguments: { sql: 'SELECT COUNT(*) AS c FROM Foo' } },
      { toolCallId: '2', functionName: 'results_ok', arguments: {} },
    ];

    const client: ToolCallingBenchmarkClient = {
      mode: 'tool-calling',
      call: vi.fn(async () => responses.shift() ?? { toolCallId: 'x', functionName: 'results_ok', arguments: {} }),
    };

    const report = await runBenchmark({
      dataset: DATASET,
      runner,
      client,
      questionIds: [1],
    });

    expect(report.summary.passed).toBe(1);
    expect(report.results[0].status).toBe('pass');
    expect((client.call as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(3);
  });

  it('counts every tool-calling attempt against the hard cap', async () => {
    const runner = makeRunner();
    const client: ToolCallingBenchmarkClient = {
      mode: 'tool-calling',
      call: vi.fn(async ({ onClientCallAttempt }) => {
        for (let i = 0; i < 21; i++) {
          onClientCallAttempt?.();
        }
        return { toolCallId: '1', functionName: 'results_ok', arguments: {} };
      }),
    };

    const report = await runBenchmark({
      dataset: DATASET,
      runner,
      client,
      questionIds: [1],
    });

    expect(report.summary.errored).toBe(1);
    expect(report.results[0].error).toContain('Exceeded maximum tool calls (20)');
  });

  it('allows exactly MAX_TOOL_CALLS tool-calling attempts for a passing question', async () => {
    const runner = makeRunner();
    let toolCalls = 0;

    const client: ToolCallingBenchmarkClient = {
      mode: 'tool-calling',
      call: vi.fn(async ({ onClientCallAttempt }) => {
        toolCalls += 1;
        const attemptsToUse = toolCalls === 1 ? 10 : 10;

        for (let i = 0; i < attemptsToUse; i++) {
          onClientCallAttempt?.();
        }

        if (toolCalls === 1) {
          return { toolCallId: '1', functionName: 'run_sql_query', arguments: { sql: 'SELECT COUNT(*) AS c FROM Foo' } };
        }
        return { toolCallId: '2', functionName: 'results_ok', arguments: {} };
      }),
    };

    const report = await runBenchmark({
      dataset: DATASET,
      runner,
      client,
      questionIds: [1],
    });

    expect(report.summary.passed).toBe(1);
    expect(report.results[0].status).toBe('pass');
    expect((client.call as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(2);
  });

  it('returns error when retry budget is exhausted', async () => {
    const runner = makeRunner();
    runner.runQuery = vi.fn(async () => {
      throw new Error('Bad SQL');
    });

    const client: ToolCallingBenchmarkClient = {
      mode: 'tool-calling',
      call: vi.fn(async () => ({
        toolCallId: '1',
        functionName: 'run_sql_query',
        arguments: { sql: 'SELECT not_valid FROM Foo' },
      })),
    };

    const report = await runBenchmark({
      dataset: DATASET,
      runner,
      client,
      questionIds: [1],
      maxRetries: 1,
    });

    expect(report.summary.errored).toBe(1);
    expect(report.results[0].status).toBe('error');
    expect(report.results[0].attempts).toBe(2);
    expect(report.results[0].error).toContain('Query failed after 1 retries');
  });

  it('records timeout errors for stalled tool calls', async () => {
    const runner = makeRunner();
    const client: ToolCallingBenchmarkClient = {
      mode: 'tool-calling',
      call: vi.fn(async ({ abortSignal }) => {
        await new Promise((_resolve, reject) => {
          abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
        return { toolCallId: 'never', functionName: 'results_ok', arguments: {} };
      }),
    };

    const report = await runBenchmark({
      dataset: DATASET,
      runner,
      client,
      questionIds: [1],
      timeoutMs: 5,
    });

    expect(report.summary.errored).toBe(1);
    expect(report.results[0].error).toContain('Timeout');
  });

  it('returns aborted report when benchmark is externally aborted', async () => {
    const runner = makeRunner();
    const controller = new AbortController();
    controller.abort();

    const client: ToolCallingBenchmarkClient = {
      mode: 'tool-calling',
      call: vi.fn(async () => ({ toolCallId: 'x', functionName: 'results_ok', arguments: {} })),
    };

    const report = await runBenchmark({
      dataset: DATASET,
      runner,
      client,
      abortSignal: controller.signal,
    });

    expect(report.meta.aborted).toBe(true);
    expect(report.summary.total).toBe(0);
  });

  it('runs grammar mode when provided', async () => {
    const runner = makeRunner();
    const replies = ['SELECT MAX(v) AS max_v FROM Foo', 'OK'];
    const client: GrammarBenchmarkClient = {
      mode: 'grammar',
      generate: vi.fn(async () => ({ text: replies.shift() ?? 'OK' })),
    };

    const report = await runBenchmark({
      dataset: DATASET,
      runner,
      client,
      questionIds: [2],
      grammar: 'root ::= "OK"',
    });

    expect(report.summary.total).toBe(1);
    expect(report.summary.passed).toBe(1);
    expect(report.results[0].generatedSql).toContain('MAX');
  });
});
