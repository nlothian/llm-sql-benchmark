import type { GrammarBenchmarkClient, ToolCallingBenchmarkClient } from '@fifthvertex/benchmark-core';
import type { LlmLogContext, LlmLogWriter } from './llm-logging.ts';
import { toolCallOpenAI } from './openai-tool-call.ts';
import { textCompletionOpenAI } from './openai-text-completion.ts';

interface OpenAIClientConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  reasoningEffort?: string;
  getLogContext?: () => LlmLogContext;
  logger?: LlmLogWriter;
}

export function createOpenAiToolCallingClient(config: OpenAIClientConfig): ToolCallingBenchmarkClient {
  return {
    mode: 'tool-calling',
    async call(options) {
      const logContext = config.getLogContext?.();
      return toolCallOpenAI({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        model: config.model,
        systemPrompt: options.systemPrompt,
        messages: options.messages,
        tools: options.tools,
        reasoningEffort: config.reasoningEffort,
        abortSignal: options.abortSignal,
        onTokenUsage: options.onTokenUsage,
        onModelName: options.onModelName,
        onClientCallAttempt: options.onClientCallAttempt,
        logContext,
        logger: config.logger,
      });
    },
  };
}

export function createOpenAiGrammarClient(config: OpenAIClientConfig): GrammarBenchmarkClient {
  return {
    mode: 'grammar',
    async generate(options) {
      const logContext = config.getLogContext?.();
      const result = await textCompletionOpenAI({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        model: config.model,
        systemPrompt: options.systemPrompt,
        messages: options.messages,
        grammar: options.grammar,
        reasoningEffort: config.reasoningEffort,
        abortSignal: options.abortSignal,
        onTokenUsage: options.onTokenUsage,
        onModelName: options.onModelName,
        logContext,
        logger: config.logger,
      });
      return { text: result.text };
    },
  };
}
