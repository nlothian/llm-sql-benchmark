import type {
  BenchmarkConversationMessage,
  BenchmarkToolCallResponse,
  BenchmarkToolDefinition,
  TokenUsage,
} from '@fifthvertex/benchmark-core';
import { abortAwareFetch } from '@fifthvertex/benchmark-core';
import { emitLog } from './llm-logging.ts';
import type { LlmLogContext, LlmLogWriter } from './llm-logging.ts';

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
  logContext?: LlmLogContext;
  logger?: LlmLogWriter;
  maxNoToolCallRetries?: number;
  onClientCallAttempt?: () => void;
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
        content: null,
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
  const {
    endpoint,
    apiKey,
    model,
    systemPrompt,
    messages,
    tools,
    maxTokens = 2048,
    reasoningEffort,
    abortSignal,
    onTokenUsage,
    onModelName,
    logContext,
    logger,
    maxNoToolCallRetries = 2,
  } = options;

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

  const maxAttempts = maxNoToolCallRetries + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    options.onClientCallAttempt?.();
    const attemptLogContext = logContext ? { ...logContext, attempt } : undefined;

    emitLog(logger, attemptLogContext, 'llm_request', 'tool-calling', endpoint, model, body);

    let errorLogged = false;
    const logError = (payload: unknown) => {
      if (errorLogged) return;
      errorLogged = true;
      emitLog(logger, attemptLogContext, 'llm_error', 'tool-calling', endpoint, model, payload);
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

    let data: Record<string, unknown>;
    try {
      data = await response.json() as Record<string, unknown>;
    } catch (error) {
      logError({ message: (error as Error).message });
      throw error;
    }
    emitLog(logger, attemptLogContext, 'llm_response', 'tool-calling', endpoint, model, data);

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

    if (tc) {
      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        parsedArgs = {};
      }
      return {
        toolCallId: tc.id ?? `call_${Date.now()}`,
        functionName: tc.function.name,
        arguments: parsedArgs,
      };
    }

    // No tool call — log and retry if attempts remain
    const willRetry = attempt < maxAttempts - 1;
    logError({ message: 'No tool call in response', attempt, willRetry, response: data });

    if (!willRetry) {
      throw new Error(`No tool call in response after ${maxAttempts} attempts`);
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error('No tool call in response');
}
