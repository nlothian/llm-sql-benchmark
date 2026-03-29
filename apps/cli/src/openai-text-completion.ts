import type { TokenUsage } from '@fifthvertex/benchmark-core';
import { abortAwareFetch } from '@fifthvertex/benchmark-core';
import { emitLog } from './llm-logging.ts';
import type { LlmLogContext, LlmLogWriter } from './llm-logging.ts';

export interface OpenAITextCompletionOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt?: string;
  messages?: Array<{role: string; content: string}>;
  grammar?: string;
  maxTokens?: number;
  reasoningEffort?: string;
  abortSignal?: AbortSignal;
  onTokenUsage?: (usage: TokenUsage) => void;
  onModelName?: (name: string) => void;
  logContext?: LlmLogContext;
  logger?: LlmLogWriter;
}

export interface TextCompletionResult {
  text: string;
  reasoning: string | null;
  usage: TokenUsage | null;
}

/** Call an OpenAI-compatible endpoint for plain text completion (no tool calling).
 *  Uses streaming to accumulate the response, since some servers (e.g. llama.cpp
 *  with reasoning_format) only support streaming mode. */
export async function textCompletionOpenAI(options: OpenAITextCompletionOptions): Promise<TextCompletionResult> {
  const {
    endpoint, apiKey, model, systemPrompt,
    grammar, maxTokens = 2048, reasoningEffort, abortSignal, onTokenUsage, onModelName, logContext, logger,
  } = options;

  if (!options.messages && !options.userPrompt) {
    throw new Error('Either messages or userPrompt must be provided');
  }

  const apiMessages = options.messages
    ? [{ role: 'system', content: systemPrompt }, ...options.messages]
    : [{ role: 'system', content: systemPrompt }, { role: 'user', content: options.userPrompt! }];

  const body: Record<string, unknown> = {
    model,
    messages: apiMessages,
    max_tokens: maxTokens,
    temperature: 0.1,
    stream: true,
  };

  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
  }

  if (grammar) {
    body.grammar = grammar;
    // Let server use reasoning_format: "auto" (default) so the model can think
    // freely without grammar constraints. The grammar only applies to the
    // content portion (SQL or "OK"), while reasoning goes through reasoning_content.
  }

  emitLog(logger, logContext, 'llm_request', 'grammar', endpoint, model, body);

  let errorLogged = false;
  const logError = (payload: unknown) => {
    if (errorLogged) return;
    errorLogged = true;
    emitLog(logger, logContext, 'llm_error', 'grammar', endpoint, model, payload);
  };

  let response: Response;
  try {
    response = await abortAwareFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    });
  } catch (error) {
    logError({ message: (error as Error).message });
    throw error;
  }

  if (!response.ok) {
    const errorBody = await response.text();
    logError({ status: response.status, body: errorBody });
    throw new Error(`API error (${response.status}): ${errorBody}`);
  }

  // Accumulate streamed SSE chunks
  let text = '';
  let reasoning = '';
  let usage: TokenUsage | null = null;
  let resolvedModel: string | undefined;

  const reader = response.body?.getReader();
  if (!reader) {
    const error = new Error('No response body');
    logError({ message: error.message });
    throw error;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (error) {
      logError({ message: (error as Error).message });
      throw error;
    }
    const { done, value } = chunk;
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete SSE lines
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') continue;

      try {
        const chunk = JSON.parse(payload) as Record<string, unknown>;

        if (!resolvedModel) {
          resolvedModel = (chunk.model_alias ?? chunk.model) as string | undefined;
        }

        const choices = chunk.choices as Array<{ delta?: { content?: string; reasoning_content?: string } }> | undefined;
        const delta = choices?.[0]?.delta;
        if (delta?.content) text += delta.content;
        if (delta?.reasoning_content) reasoning += delta.reasoning_content;

        // Usage may appear in the final chunk
        const usageData = chunk.usage as Record<string, number> | undefined;
        if (usageData) {
          usage = {
            inputTokens: usageData.prompt_tokens ?? 0,
            outputTokens: usageData.completion_tokens ?? 0,
            ...(typeof usageData.cost === 'number' ? { cost: usageData.cost } : {}),
          };
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  if (usage) onTokenUsage?.(usage);
  if (resolvedModel) onModelName?.(resolvedModel);
  emitLog(logger, logContext, 'llm_response', 'grammar', endpoint, model, {
    text,
    reasoning: reasoning || null,
    usage,
    model: resolvedModel ?? model,
  });

  return { text, reasoning: reasoning || null, usage };
}
