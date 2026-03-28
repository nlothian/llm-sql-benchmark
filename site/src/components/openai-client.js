/**
 * Browser-compatible OpenAI tool-calling client.
 * Adapted from apps/cli/src/openai-tool-call.ts (stripped of Node logging).
 */

function toOpenAITools(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function toOpenAIMessages(systemPrompt, messages) {
  const out = [{ role: "system", content: systemPrompt }];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: m.toolCall.id,
            type: "function",
            function: {
              name: m.toolCall.name,
              arguments: JSON.stringify(m.toolCall.arguments),
            },
          },
        ],
      });
    } else if (m.role === "tool_result") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}

function extractUsage(data) {
  const usage = data.usage;
  if (!usage) return null;
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    ...(typeof usage.cost === "number" ? { cost: usage.cost } : {}),
  };
}

async function toolCallOpenAI(options) {
  const {
    endpoint,
    apiKey,
    model,
    systemPrompt,
    messages,
    tools,
    maxTokens = 2048,
    abortSignal,
    onTokenUsage,
    onModelName,
    maxNoToolCallRetries = 2,
  } = options;

  const body = {
    model,
    messages: toOpenAIMessages(systemPrompt, messages),
    tools: toOpenAITools(tools),
    max_tokens: maxTokens,
    temperature: 0.1,
  };

  const maxAttempts = maxNoToolCallRetries + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    options.onClientCallAttempt?.();

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();

    const usage = extractUsage(data);
    if (usage) onTokenUsage?.(usage);

    const modelName = data.model_alias ?? data.model;
    if (modelName) onModelName?.(modelName);

    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    if (tc) {
      let parsedArgs;
      try {
        parsedArgs = JSON.parse(tc.function.arguments);
      } catch {
        parsedArgs = {};
      }
      return {
        toolCallId: tc.id ?? `call_${Date.now()}`,
        functionName: tc.function.name,
        arguments: parsedArgs,
      };
    }

    if (attempt >= maxAttempts - 1) {
      throw new Error(`No tool call in response after ${maxAttempts} attempts`);
    }
  }

  throw new Error("No tool call in response");
}

/**
 * Wraps a tool-calling client to capture each LLM round-trip for live tracing.
 * onTraceEvent receives { phase, systemPrompt, call } where:
 *   phase: 'started' (call in flight, call.pending=true) or 'completed'
 *   call: matches CallDetail shape { req, resp, retries, error, pending }
 */
export function createTracingClient(innerClient, onTraceEvent) {
  let capturedSystemPrompt = null;
  let prevMessageCount = 0;

  function convertMessages(systemPrompt, messages) {
    const openAI = toOpenAIMessages(systemPrompt, messages);
    return openAI.slice(1); // drop system message
  }

  function reset() {
    capturedSystemPrompt = null;
    prevMessageCount = 0;
  }

  return {
    mode: innerClient.mode,
    reset,
    async call(options) {
      if (capturedSystemPrompt === null) {
        capturedSystemPrompt = options.systemPrompt;
      }

      const allReq = convertMessages(options.systemPrompt, options.messages);
      let reqSlice = allReq;
      if (prevMessageCount > 0) {
        reqSlice = allReq.slice(prevMessageCount);
        // Skip leading assistant message (already shown as prev call's resp)
        if (reqSlice.length > 0 && reqSlice[0].role === "assistant") {
          reqSlice = reqSlice.slice(1);
        }
      }

      // Emit pending call before the request
      onTraceEvent({
        phase: "started",
        systemPrompt: capturedSystemPrompt,
        call: { req: reqSlice, resp: null, retries: null, error: null, pending: true },
      });

      let callUsage = null;
      const wrappedOnTokenUsage = (usage) => {
        callUsage = {
          prompt_tokens: usage.inputTokens,
          completion_tokens: usage.outputTokens,
        };
        options.onTokenUsage?.(usage);
      };

      try {
        const response = await innerClient.call({
          ...options,
          onTokenUsage: wrappedOnTokenUsage,
        });

        const resp = {
          content: null,
          tool_calls: [{
            function: {
              name: response.functionName,
              arguments: JSON.stringify(response.arguments),
            },
          }],
          reasoning: null,
          usage: callUsage,
        };

        prevMessageCount = allReq.length;
        onTraceEvent({
          phase: "completed",
          systemPrompt: capturedSystemPrompt,
          call: { req: reqSlice, resp, retries: null, error: null, pending: false },
        });

        return response;
      } catch (err) {
        prevMessageCount = allReq.length;
        onTraceEvent({
          phase: "completed",
          systemPrompt: capturedSystemPrompt,
          call: { req: reqSlice, resp: null, retries: null, error: err.message, pending: false },
        });
        throw err;
      }
    },
  };
}

export function createBrowserToolCallingClient(config) {
  return {
    mode: "tool-calling",
    async call(options) {
      return toolCallOpenAI({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        model: config.model,
        systemPrompt: options.systemPrompt,
        messages: options.messages,
        tools: options.tools,
        abortSignal: options.abortSignal,
        onTokenUsage: options.onTokenUsage,
        onModelName: options.onModelName,
        onClientCallAttempt: options.onClientCallAttempt,
      });
    },
  };
}
