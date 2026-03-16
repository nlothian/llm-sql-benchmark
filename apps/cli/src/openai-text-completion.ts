import type { TokenUsage } from '@fifthvertex/benchmark-core';

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
}

export interface TextCompletionResult {
  text: string;
  usage: TokenUsage | null;
}

/** Call an OpenAI-compatible endpoint for plain text completion (no tool calling).
 *  Uses streaming to accumulate the response, since some servers (e.g. llama.cpp
 *  with reasoning_format) only support streaming mode. */
export async function textCompletionOpenAI(options: OpenAITextCompletionOptions): Promise<TextCompletionResult> {
  const {
    endpoint, apiKey, model, systemPrompt,
    grammar, maxTokens = 2048, reasoningEffort, abortSignal, onTokenUsage, onModelName,
  } = options;

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

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: abortSignal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API error (${response.status}): ${errorBody}`);
  }

  // Accumulate streamed SSE chunks
  let text = '';
  let usage: TokenUsage | null = null;
  let resolvedModel: string | undefined;

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
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

        const choices = chunk.choices as Array<{ delta?: { content?: string } }> | undefined;
        const delta = choices?.[0]?.delta?.content;
        if (delta) text += delta;

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

  return { text, usage };
}
