// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/benchmark.ts';

const tempDirs: string[] = [];
const servers: Server[] = [];

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

afterEach(() => {
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

async function createMockOpenAiServer(responses: Array<Record<string, unknown>>): Promise<{
  endpoint: string;
  requests: Array<Record<string, unknown>>;
}> {
  const requests: Array<Record<string, unknown>> = [];
  const queue = [...responses];
  const fallback = responses[responses.length - 1];

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        requests.push(JSON.parse(body) as Record<string, unknown>);
      } catch {
        requests.push({ raw: body });
      }

      const payload = queue.shift() ?? fallback;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
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
  };
}

describe('CLI integration stack', () => {
  it('writes expected JSON output and exits 0 on successful benchmark run', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'benchmark-cli-pass-'));
    tempDirs.push(rootDir);
    makeFixtureDataset(rootDir);

    const outputPath = join(rootDir, 'benchmark-pass.json');
    const mockApi = await createMockOpenAiServer([
      makeToolCallApiResponse('run_sql_query', { sql: 'SELECT COUNT(*) AS row_count FROM Foo' }, 'call_1'),
      makeToolCallApiResponse('results_ok', {}, 'call_2'),
    ]);

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
  });

  it('returns exit code 1 when benchmark has failures', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'benchmark-cli-fail-'));
    tempDirs.push(rootDir);
    makeFixtureDataset(rootDir);

    const outputPath = join(rootDir, 'benchmark-fail.json');
    const mockApi = await createMockOpenAiServer([
      makeToolCallApiResponse('results_ok', {}, 'call_1'),
    ]);

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
});
