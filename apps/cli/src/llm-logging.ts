import type { BenchmarkDifficulty, BenchmarkQuestion } from '@fifthvertex/benchmark-core';

export type LlmLogMode = 'tool-calling' | 'grammar';
export type LlmLogEvent = 'llm_request' | 'llm_response' | 'llm_error';

export interface LlmLogContext {
  runId: string;
  benchmarkFileName: string;
  logFileName: string;
  questionId: number | null;
  questionDifficulty: BenchmarkDifficulty | null;
  questionText: string | null;
  questionLabel: string | null;
  callIndex: number;
  attempt?: number;
}

export interface LlmLogEntry extends LlmLogContext {
  timestamp: string;
  event: LlmLogEvent;
  mode: LlmLogMode;
  endpoint: string;
  model: string;
  payload: unknown;
}

export type LlmLogWriter = (entry: LlmLogEntry) => void;

export function emitLog(
  logger: LlmLogWriter | undefined,
  context: LlmLogContext | undefined,
  event: LlmLogEvent,
  mode: LlmLogMode,
  endpoint: string,
  model: string,
  payload: unknown,
): void {
  if (!logger || !context) return;

  logger({
    ...context,
    timestamp: new Date().toISOString(),
    event,
    mode,
    endpoint,
    model,
    payload,
  });
}

export function formatQuestionLabel(
  question: Pick<BenchmarkQuestion, 'id' | 'difficulty' | 'question'> | null,
): string | null {
  if (!question) return null;
  return `[Q${question.id}][${question.difficulty}] ${question.question}`;
}
