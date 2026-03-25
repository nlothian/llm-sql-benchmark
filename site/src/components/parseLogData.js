/**
 * Parse JSONL log text into per-question calls and a system prompt.
 *
 * Each call entry has { req, resp } for the final (successful) attempt,
 * plus an optional `retries` array of { req, resp, error } for failed attempts.
 *
 * @param {string} text  Raw JSONL text (one JSON object per line)
 * @returns {{ systemPrompt: string|null, callsPerQuestion: Record<number, Array<{req: object[], resp: object, retries?: Array<{req: object[], resp: object, error: string}>}>> }}
 */
export function parseJsonlText(text) {
  const lines = text.trim().split('\n');
  const entries = lines.map(line => JSON.parse(line));

  let systemPrompt = null;
  // { questionId: { callIndex: { attempts: { [attempt]: { req?, resp?, error? } } } } }
  const grouped = {};

  for (const entry of entries) {
    const { questionId, callIndex, event, payload, attempt = 0 } = entry;
    if (!grouped[questionId]) grouped[questionId] = {};
    if (!grouped[questionId][callIndex]) grouped[questionId][callIndex] = { attempts: {} };
    if (!grouped[questionId][callIndex].attempts[attempt]) {
      grouped[questionId][callIndex].attempts[attempt] = {};
    }

    const slot = grouped[questionId][callIndex].attempts[attempt];

    if (event === 'llm_request') {
      // Extract system prompt from the very first request
      if (systemPrompt === null && payload.messages?.[0]?.role === 'system') {
        systemPrompt = payload.messages[0].content;
      }
      // req = messages minus the system message
      slot.req = payload.messages?.filter(m => m.role !== 'system') || [];
    } else if (event === 'llm_response') {
      const choice = payload.choices?.[0];
      const msg = choice?.message || {};
      slot.resp = {
        content: (msg.content ?? payload.text) || null,
        tool_calls: msg.tool_calls || null,
        reasoning: (msg.reasoning ?? payload.reasoning) || null,
        usage: payload.usage
          ? { prompt_tokens: payload.usage.prompt_tokens, completion_tokens: payload.usage.completion_tokens }
          : null,
      };
    } else if (event === 'llm_error') {
      slot.error = payload.message || 'Unknown error';
    }
  }

  // Convert index maps to sorted arrays, collapsing attempts
  const callsPerQuestion = {};
  for (const [qid, indexMap] of Object.entries(grouped)) {
    const sorted = Object.keys(indexMap)
      .map(Number)
      .sort((a, b) => a - b);
    callsPerQuestion[Number(qid)] = sorted.map(idx => {
      const attemptKeys = Object.keys(indexMap[idx].attempts)
        .map(Number)
        .sort((a, b) => a - b);

      if (attemptKeys.length <= 1) {
        // No retries — return the single attempt as before
        const only = indexMap[idx].attempts[attemptKeys[0]] || {};
        return { req: only.req, resp: only.resp, error: only.error };
      }

      // Multiple attempts: last one is the final attempt, earlier ones are retries
      const lastKey = attemptKeys[attemptKeys.length - 1];
      const final = indexMap[idx].attempts[lastKey];
      const retries = attemptKeys.slice(0, -1).map(k => indexMap[idx].attempts[k]);

      return { req: final.req, resp: final.resp, retries };
    });
  }

  return { systemPrompt, callsPerQuestion };
}
