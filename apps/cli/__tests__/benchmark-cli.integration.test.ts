// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/benchmark.ts';

const tempDirs: string[] = [];
const servers: Server[] = [];
const originalCwd = process.cwd();

type JsonRecord = Record<string, unknown>;

interface MockHttpResponse {
  status?: number;
  headers?: Record<string, string>;
  body: string;
}

function makeFixtureDataset(rootDir: string): void {
  const tablesDir = join(rootDir, 'tables');
  mkdirSync(tablesDir, { recursive: true });

  writeFileSync(
    join(tablesDir, 'Foo.csv'),
    `id,value
1,10
2,20
3,30
`,
  );

  const questions = [
    {
      id: 1,
      question: 'How many rows are in Foo?',
      difficulty: 'easy',
      sql: 'SELECT COUNT(*) AS row_count FROM Foo',
      included_tables: ['Foo'],
      row_count: 1,
      columns: ['row_count'],
      first_row: { row_count: 3 },
    },
  ];

  const registertables = ['CREATE VIEW Foo AS SELECT * FROM read_csv_auto(\'tables/Foo.csv\')'];
  writeFileSync(join(rootDir, 'questions.json'), JSON.stringify({ questions, registertables }, null, 2), 'utf-8');
}

function makeTwoQuestionFixtureDataset(rootDir: string): void {
  const tablesDir = join(rootDir, 'tables');
  mkdirSync(tablesDir, { recursive: true });

  writeFileSync(
    join(tablesDir, 'Foo.csv'),
    `id,value
1,10
2,20
3,30
`,
  );

  const questions = [
    {
      id: 1,
      question: 'How many rows are in Foo?',
      difficulty: 'easy',
      sql: 'SELECT COUNT(*) AS row_count FROM Foo',
      included_tables: ['Foo'],
      row_count: 1,
      columns: ['row_count'],
      first_row: { row_count: 3 },
    },
    {
      id: 2,
      question: 'What is the total value in Foo?',
      difficulty: 'easy',
      sql: 'SELECT SUM(value) AS total_value FROM Foo',
      included_tables: ['Foo'],
      row_count: 1,
      columns: ['total_value'],
      first_row: { total_value: 60 },
    },
  ];

  const registertables = ['CREATE VIEW Foo AS SELECT * FROM read_csv_auto(\'tables/Foo.csv\')'];
  writeFileSync(join(rootDir, 'questions.json'), JSON.stringify({ questions, registertables }, null, 2), 'utf-8');
}

afterEach(() => {
  process.chdir(originalCwd);

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;

  for (const server of servers) {
    server.close();
  }
  servers.length = 0;
});

function makeToolCallApiResponse(functionName: string, args: Record<string, unknown>, id: string) {
  return {
    id: `mock-${id}`,
    model: 'mock-model',
    usage: {
      prompt_tokens: 20,
      completion_tokens: 5,
    },
    choices: [
      {
        message: {
          tool_calls: [
            {
              id,
              type: 'function',
              function: {
                name: functionName,
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
  };
}

function makeJsonResponse(payload: JsonRecord, status = 200): MockHttpResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function makeSseResponse(events: Array<JsonRecord | '[DONE]'>): MockHttpResponse {
  const body = events
    .map((event) => (event === '[DONE]' ? 'data: [DONE]\n\n' : `data: ${JSON.stringify(event)}\n\n`))
    .join('');

  return {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    body,
  };
}

async function createMockOpenAiServer(responses: MockHttpResponse[]): Promise<{
  endpoint: string;
  requests: JsonRecord[];
  requestTimes: number[];
}> {
  const requests: JsonRecord[] = [];
  const requestTimes: number[] = [];
  const queue = [...responses];
  const fallback = responses[responses.length - 1];

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      requestTimes.push(Date.now());
      try {
        requests.push(JSON.parse(body) as Record<string, unknown>);
      } catch {
        requests.push({ raw: body });
      }

      const payload = queue.shift() ?? fallback;
      res.writeHead(payload.status ?? 200, payload.headers ?? { 'Content-Type': 'application/json' });
      res.end(payload.body);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  servers.push(server);
  const address = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
    requests,
    requestTimes,
  };
}

function readJsonl(filePath: string): JsonRecord[] {
  const content = readFileSync(filePath, 'utf-8').trim();
  return content.split('\n').map(line => JSON.parse(line) as JsonRecord);
}

function findSingleLogFile(rootDir: string, stem: string): string {
  const logDir = join(rootDir, 'data', 'logs');
  const files = readdirSync(logDir);
  const matches = files.filter(file => new RegExp(`^${stem}-\\d{8}T\\d{6}Z\\.jsonl$`).test(file));
  expect(matches).toHaveLength(1);
  return join(logDir, matches[0]);
}

describe('CLI integration stack', () => {
  it('writes JSONL request and response logs for tool-calling runs', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'benchmark-cli-pass-'));
    tempDirs.push(rootDir);
    makeFixtureDataset(rootDir);

    const outputPath = join(rootDir, 'benchmark-pass.json');
    const mockApi = await createMockOpenAiServer([
      makeJsonResponse(makeToolCallApiResponse('run_sql_query', { sql: 'SELECT COUNT(*) AS row_count FROM Foo' }, 'call_1')),
      makeJsonResponse(makeToolCallApiResponse('results_ok', {}, 'call_2')),
    ]);

    process.chdir(rootDir);
    const exitCode = await runCli([
      '--endpoint', mockApi.endpoint,
      '--model', 'mock-model',
      '--data-dir', rootDir,
      '--output', outputPath,
    ]);

    expect(exitCode).toBe(0);
    expect(mockApi.requests.length).toBeGreaterThan(0);

    const output = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<string, unknown>;
    const summary = output.summary as Record<string, number>;
    const meta = output.meta as Record<string, unknown>;
    const results = output.results as Array<Record<string, unknown>>;

    expect(meta.datasetId).toBe('custom');
    expect(meta.model).toBe('mock-model');
    expect(summary.total).toBe(1);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.errored).toBe(0);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('pass');
    expect(results[0].difficulty).toBe('easy');
    expect(results[0].result).toEqual({
      rowCount: 1,
      columns: ['row_count'],
      firstRow: { row_count: '3' },
    });
    expect(results[0].throttleWaitMs).toBeUndefined();

    const logPath = findSingleLogFile(rootDir, 'benchmark-pass');
    const logLines = readJsonl(logPath);
    expect(logLines).toHaveLength(4);

    for (const line of logLines) {
      expect(line.questionId).toBe(1);
      expect(line.questionDifficulty).toBe('easy');
      expect(line.questionText).toBe('How many rows are in Foo?');
      expect(line.questionLabel).toBe('[Q1][easy] How many rows are in Foo?');
      expect(line.benchmarkFileName).toBe('benchmark-pass.json');
      expect(line.logFileName).toBeTypeOf('string');
    }

    expect(logLines[0].event).toBe('llm_request');
    expect(logLines[0].mode).toBe('tool-calling');
    expect(logLines[0].callIndex).toBe(1);
    expect((logLines[0].payload as JsonRecord).messages).toBeDefined();
    expect((logLines[0].payload as JsonRecord).tools).toBeDefined();

    expect(logLines[1].event).toBe('llm_response');
    expect(logLines[1].callIndex).toBe(1);
    expect((((logLines[1].payload as JsonRecord).choices as Array<JsonRecord>)[0].message as JsonRecord).tool_calls).toBeDefined();

    expect(logLines[2].event).toBe('llm_request');
    expect(logLines[2].callIndex).toBe(2);
    expect(logLines[3].event).toBe('llm_response');
    expect(logLines[3].callIndex).toBe(2);
  });

  it('returns exit code 1 when benchmark has failures', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'benchmark-cli-fail-'));
    tempDirs.push(rootDir);
    makeFixtureDataset(rootDir);

    const outputPath = join(rootDir, 'benchmark-fail.json');
    const mockApi = await createMockOpenAiServer([
      makeJsonResponse(makeToolCallApiResponse('results_ok', {}, 'call_1')),
    ]);

    process.chdir(rootDir);
    const exitCode = await runCli([
      '--endpoint', mockApi.endpoint,
      '--model', 'mock-model',
      '--data-dir', rootDir,
      '--output', outputPath,
    ]);

    expect(exitCode).toBe(1);

    const output = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<string, unknown>;
    const summary = output.summary as Record<string, number>;
    const results = output.results as Array<Record<string, unknown>>;

    expect(summary.total).toBe(1);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('fail');
  });

  it('writes final assembled grammar responses instead of raw SSE chunks', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'benchmark-cli-grammar-'));
    tempDirs.push(rootDir);
    makeFixtureDataset(rootDir);

    const outputPath = join(rootDir, 'benchmark-grammar.json');
    const mockApi = await createMockOpenAiServer([
      makeSseResponse([
        { model: 'mock-model', choices: [{ delta: { content: 'SELECT COUNT(*) AS row_count FROM Foo' } }] },
        { model: 'mock-model', choices: [{}], usage: { prompt_tokens: 10, completion_tokens: 4 } },
        '[DONE]',
      ]),
      makeSseResponse([
        { model: 'mock-model', choices: [{ delta: { content: 'OK' } }] },
        { model: 'mock-model', choices: [{}], usage: { prompt_tokens: 2, completion_tokens: 1 } },
        '[DONE]',
      ]),
    ]);

    process.chdir(rootDir);
    const exitCode = await runCli([
      '--endpoint', mockApi.endpoint,
      '--model', 'mock-model',
      '--data-dir', rootDir,
      '--output', outputPath,
      '--grammar',
    ]);

    expect(exitCode).toBe(0);

    const logPath = findSingleLogFile(rootDir, 'benchmark-grammar');
    const logLines = readJsonl(logPath);
    const responseLines = logLines.filter(line => line.event === 'llm_response');
    expect(responseLines).toHaveLength(2);

    expect((responseLines[0].payload as JsonRecord).text).toBe('SELECT COUNT(*) AS row_count FROM Foo');
    expect((responseLines[0].payload as JsonRecord).usage).toEqual({ inputTokens: 10, outputTokens: 4 });
    expect((responseLines[0].payload as JsonRecord).chunks).toBeUndefined();
    expect((responseLines[1].payload as JsonRecord).text).toBe('OK');
  });

  it('writes request and error log lines when the API returns an error', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'benchmark-cli-api-error-'));
    tempDirs.push(rootDir);
    makeFixtureDataset(rootDir);

    const outputPath = join(rootDir, 'benchmark-api-error.json');
    const mockApi = await createMockOpenAiServer([
      {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
        body: 'provider exploded',
      },
    ]);

    process.chdir(rootDir);
    const exitCode = await runCli([
      '--endpoint', mockApi.endpoint,
      '--model', 'mock-model',
      '--data-dir', rootDir,
      '--output', outputPath,
    ]);

    expect(exitCode).toBe(1);

    const output = JSON.parse(readFileSync(outputPath, 'utf-8')) as JsonRecord;
    const summary = output.summary as Record<string, number>;
    expect(summary.errored).toBe(1);

    const logPath = findSingleLogFile(rootDir, 'benchmark-api-error');
    const logLines = readJsonl(logPath);
    expect(logLines).toHaveLength(2);
    expect(logLines[0].event).toBe('llm_request');
    expect(logLines[1].event).toBe('llm_error');
    expect((logLines[1].payload as JsonRecord).status).toBe(500);
    expect((logLines[1].payload as JsonRecord).body).toBe('provider exploded');
  });

  it('enforces throttle-time between LLM calls within a question', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'benchmark-cli-throttle-gap-'));
    tempDirs.push(rootDir);
    makeFixtureDataset(rootDir);

    const outputPath = join(rootDir, 'benchmark-throttle-gap.json');
    const mockApi = await createMockOpenAiServer([
      makeJsonResponse(makeToolCallApiResponse('run_sql_query', { sql: 'SELECT COUNT(*) AS row_count FROM Foo' }, 'call_1')),
      makeJsonResponse(makeToolCallApiResponse('results_ok', {}, 'call_2')),
    ]);

    process.chdir(rootDir);
    const exitCode = await runCli([
      '--endpoint', mockApi.endpoint,
      '--model', 'mock-model',
      '--data-dir', rootDir,
      '--output', outputPath,
      '--throttle-time', '0.08',
    ]);

    expect(exitCode).toBe(0);
    expect(mockApi.requestTimes).toHaveLength(2);

    const interCallGapMs = mockApi.requestTimes[1] - mockApi.requestTimes[0];
    expect(interCallGapMs).toBeGreaterThanOrEqual(60);

    const output = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<string, unknown>;
    const results = output.results as Array<Record<string, unknown>>;
    expect(results[0].throttleWaitMs).toBeTypeOf('number');
    expect(results[0].throttleWaitMs as number).toBeGreaterThanOrEqual(60);
    expect(results[0].durationMs as number).toBeLessThan(interCallGapMs);
  });

  it('enforces throttle-time across question boundaries', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'benchmark-cli-throttle-reset-'));
    tempDirs.push(rootDir);
    makeTwoQuestionFixtureDataset(rootDir);

    const outputPath = join(rootDir, 'benchmark-throttle-reset.json');
    const mockApi = await createMockOpenAiServer([
      makeJsonResponse(makeToolCallApiResponse('run_sql_query', { sql: 'SELECT COUNT(*) AS row_count FROM Foo' }, 'call_1')),
      makeJsonResponse(makeToolCallApiResponse('results_ok', {}, 'call_2')),
      makeJsonResponse(makeToolCallApiResponse('run_sql_query', { sql: 'SELECT SUM(value) AS total_value FROM Foo' }, 'call_3')),
      makeJsonResponse(makeToolCallApiResponse('results_ok', {}, 'call_4')),
    ]);

    process.chdir(rootDir);
    const exitCode = await runCli([
      '--endpoint', mockApi.endpoint,
      '--model', 'mock-model',
      '--data-dir', rootDir,
      '--output', outputPath,
      '--throttle-time', '0.2',
    ]);

    expect(exitCode).toBe(0);
    expect(mockApi.requestTimes).toHaveLength(4);

    const firstQuestionGapMs = mockApi.requestTimes[1] - mockApi.requestTimes[0];
    const crossQuestionGapMs = mockApi.requestTimes[2] - mockApi.requestTimes[1];
    const secondQuestionGapMs = mockApi.requestTimes[3] - mockApi.requestTimes[2];

    expect(firstQuestionGapMs).toBeGreaterThanOrEqual(170);
    expect(secondQuestionGapMs).toBeGreaterThanOrEqual(170);
    expect(crossQuestionGapMs).toBeGreaterThanOrEqual(170);

    const output = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<string, unknown>;
    const results = output.results as Array<Record<string, unknown>>;
    expect(results[0].throttleWaitMs).toBeTypeOf('number');
    expect(results[1].throttleWaitMs).toBeTypeOf('number');
  });

  it('fails fast on invalid throttle-time values', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const negativeExitCode = await runCli([
        '--endpoint', 'http://localhost:9999/v1/chat/completions',
        '--model', 'mock-model',
        '--throttle-time=-1',
      ]);
      expect(negativeExitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith('Error: --throttle-time must be a finite number >= 0');

      errorSpy.mockClear();

      const nanExitCode = await runCli([
        '--endpoint', 'http://localhost:9999/v1/chat/completions',
        '--model', 'mock-model',
        '--throttle-time', 'not-a-number',
      ]);
      expect(nanExitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith('Error: --throttle-time must be a finite number >= 0');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
