import type {
  BenchmarkConversationMessage,
  BenchmarkToolCallResponse,
  BenchmarkToolDefinition,
  TokenUsage,
} from '@fifthvertex/benchmark-core';

export interface OpenAIToolCallOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: BenchmarkConversationMessage[];
  tools: BenchmarkToolDefinition[];
  maxTokens?: number;
  reasoningEffort?: string;
  abortSignal?: AbortSignal;
  onTokenUsage?: (usage: TokenUsage) => void;
  onModelName?: (name: string) => void;
}

/** Convert internal ToolDefinition[] to OpenAI function-calling format */
export function toOpenAITools(tools: BenchmarkToolDefinition[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Convert internal messages to OpenAI messages format */
export function toOpenAIMessages(systemPrompt: string, messages: BenchmarkConversationMessage[]) {
  const out: Record<string, unknown>[] = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        tool_calls: [{
          id: m.toolCall.id,
          type: 'function',
          function: {
            name: m.toolCall.name,
            arguments: JSON.stringify(m.toolCall.arguments),
          },
        }],
      });
    } else if (m.role === 'tool_result') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}

/** Extract token usage from OpenAI response */
function extractUsage(data: Record<string, unknown>): TokenUsage | null {
  const usage = data.usage as Record<string, number> | undefined;
  if (!usage) return null;
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    ...(typeof usage.cost === 'number' ? { cost: usage.cost } : {}),
  };
}

/** Call an OpenAI-compatible tool-calling endpoint */
export async function toolCallOpenAI(options: OpenAIToolCallOptions): Promise<BenchmarkToolCallResponse> {
  const { endpoint, apiKey, model, systemPrompt, messages, tools, maxTokens = 2048, reasoningEffort, abortSignal, onTokenUsage, onModelName } = options;

  const body: Record<string, unknown> = {
    model,
    messages: toOpenAIMessages(systemPrompt, messages),
    tools: toOpenAITools(tools),
    max_tokens: maxTokens,
    temperature: 0.1,
  };

  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
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

  const data = await response.json() as Record<string, unknown>;
  const usage = extractUsage(data);
  if (usage) {
    onTokenUsage?.(usage);
  }

  const modelName = (data.model_alias ?? data.model) as string | undefined;
  if (modelName) {
    onModelName?.(modelName);
  }

  const choices = data.choices as Array<{ message: { tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> | undefined;
  const message = choices?.[0]?.message;
  const tc = message?.tool_calls?.[0];
  if (!tc) throw new Error('No tool call in response');

  return {
    toolCallId: tc.id ?? `call_${Date.now()}`,
    functionName: tc.function.name,
    arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
  };
}
