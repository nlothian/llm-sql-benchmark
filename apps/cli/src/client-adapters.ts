import type { GrammarBenchmarkClient, ToolCallingBenchmarkClient } from '@fifthvertex/benchmark-core';
import { toolCallOpenAI } from './openai-tool-call.ts';
import { textCompletionOpenAI } from './openai-text-completion.ts';

interface OpenAIClientConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  reasoningEffort?: string;
}

export function createOpenAiToolCallingClient(config: OpenAIClientConfig): ToolCallingBenchmarkClient {
  return {
    mode: 'tool-calling',
    async call(options) {
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
      });
    },
  };
}

export function createOpenAiGrammarClient(config: OpenAIClientConfig): GrammarBenchmarkClient {
  return {
    mode: 'grammar',
    async generate(options) {
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
      });
      return { text: result.text };
    },
  };
}
