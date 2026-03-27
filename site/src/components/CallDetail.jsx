import { CodeBlock } from "./shared.jsx";

function ReasoningBlock({ text }) {
  if (!text) return null;
  return (
    <div style={{
      background: "#fefbf3", borderLeft: "3px solid #e8b93c", padding: "12px 16px",
      borderRadius: "0 8px 8px 0", margin: "8px 0", fontSize: 13, lineHeight: 1.7,
      color: "#5a4e2e", whiteSpace: "pre-wrap", wordBreak: "break-word"
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#a08420", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Thinking</div>
      {text}
    </div>
  );
}

function ToolCallBlock({ tc }) {
  const name = tc?.function?.name || "unknown";
  let args = tc?.function?.arguments || "";
  try {
    const parsed = JSON.parse(args);
    args = JSON.stringify(parsed, null, 2);
  } catch {}
  return (
    <div style={{ margin: "8px 0" }}>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 6, background: "#eeedfe",
        color: "#534ab7", fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 6
      }}>
        Tool call: {name}
      </div>
      {name !== "results_ok" && <CodeBlock code={args} />}
    </div>
  );
}

function ToolResultBlock({ content }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0" }}>
      <div style={{
        maxWidth: "85%",
        background: "#e6f5ee", borderRadius: "16px 16px 4px 16px",
        padding: "10px 16px", fontSize: 12.5, lineHeight: 1.6,
        color: "#1a4a3a", whiteSpace: "pre-wrap", wordBreak: "break-word",
        fontFamily: "'JetBrains Mono', monospace"
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#0f6e56", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Tool result</div>
        {content}
      </div>
    </div>
  );
}

function RetryAttemptBlock({ retry, attemptIndex, totalAttempts }) {
  const hasLlmContent = retry.resp?.reasoning || retry.resp?.content || retry.resp?.tool_calls;
  return (
    <div style={{ marginBottom: 12 }}>
      {/* LLM response bubble (left-aligned) */}
      {hasLlmContent && (
        <div style={{ display: "flex", justifyContent: "flex-start", margin: "8px 0" }}>
          <div style={{
            maxWidth: "92%",
            background: "#f5f4f0",
            borderRadius: "16px 16px 16px 4px",
            padding: "12px 16px"
          }}>
            {retry.resp.reasoning && <ReasoningBlock text={retry.resp.reasoning} />}
            {retry.resp.content && (
              <div style={{
                fontSize: 13, color: "#333", lineHeight: 1.6,
                whiteSpace: "pre-wrap", wordBreak: "break-word"
              }}>
                {retry.resp.content}
              </div>
            )}
            {retry.resp.tool_calls && retry.resp.tool_calls.map((tc, j) => (
              <ToolCallBlock key={`retry-tc-${j}`} tc={tc} />
            ))}
          </div>
        </div>
      )}
      {/* Harness error (right-aligned, red) */}
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0" }}>
        <div style={{
          maxWidth: "85%",
          background: "#fcebeb", borderRadius: "16px 16px 4px 16px",
          padding: "10px 16px", border: "1px solid #f0c5c5"
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: "#a32d2d",
            textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4
          }}>
            Attempt {attemptIndex + 1} of {totalAttempts} — {retry.error || "No tool call in response"}
          </div>
          <div style={{ fontSize: 12, color: "#791f1f", lineHeight: 1.5 }}>
            The LLM did not return a valid tool call. The harness will retry the same request.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CallDetail({ call, index, totalCalls, maxCalls }) {
  const { req, resp, retries, error } = call;
  const totalAttempts = retries ? retries.length + 1 : 1;

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Centered call divider */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        margin: "16px 0 12px"
      }}>
        <div style={{ flex: 1, height: 1, background: "#e8e6e0" }} />
        <div style={{
          fontSize: 11, fontWeight: 600, color: "#999",
          textTransform: "uppercase", letterSpacing: 0.5,
          display: "flex", alignItems: "center", gap: 6,
          whiteSpace: "nowrap"
        }}>
          <span style={{
            width: 20, height: 20, borderRadius: "50%", background: "#eeedfe",
            color: "#534ab7", display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 700
          }}>{index + 1}</span>
          Call {index + 1} of {maxCalls || totalCalls}
          {resp?.usage && (
            <span style={{ fontWeight: 400, color: "#ccc" }}>
              {resp.usage.prompt_tokens}→{resp.usage.completion_tokens} tokens
            </span>
          )}
          {retries && retries.length > 0 && (
            <span style={{ fontSize: 10, background: "#faeeda", color: "#854f0b", padding: "2px 6px", borderRadius: 4, fontWeight: 500 }}>
              {retries.length} {retries.length === 1 ? "retry" : "retries"}
            </span>
          )}
        </div>
        <div style={{ flex: 1, height: 1, background: "#e8e6e0" }} />
      </div>

      {/* Request messages (harness context: tool results, user messages) */}
      {req && req.map((m, i) => {
        if (m.role === "user") {
          return (
            <div key={i} style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0" }}>
              <div style={{
                maxWidth: "85%",
                background: "#dce8fc",
                borderRadius: "16px 16px 4px 16px",
                padding: "10px 16px",
                fontSize: 13, color: "#1e3a6e", lineHeight: 1.6,
                whiteSpace: "pre-wrap", wordBreak: "break-word"
              }}>
                {m.content}
              </div>
            </div>
          );
        }
        if (m.role === "assistant" && m.tool_calls) {
          return (
            <div key={i} style={{ display: "flex", justifyContent: "flex-start", margin: "8px 0" }}>
              <div style={{
                maxWidth: "92%",
                background: "#f5f4f0",
                borderRadius: "16px 16px 16px 4px",
                padding: "10px 14px"
              }}>
                {m.tool_calls.map((tc, j) => <ToolCallBlock key={`tc-${i}-${j}`} tc={tc} />)}
              </div>
            </div>
          );
        }
        if (m.role === "tool") {
          return <ToolResultBlock key={i} content={m.content} />;
        }
        return null;
      })}

      {/* Retries (failed attempts before the final response) */}
      {retries && retries.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {retries.map((retry, ri) => (
            <RetryAttemptBlock key={`retry-${ri}`} retry={retry} attemptIndex={ri} totalAttempts={totalAttempts} />
          ))}
        </div>
      )}

      {/* LLM Response bubble */}
      {resp && (resp.reasoning || resp.content || resp.tool_calls) && (
        <div style={{ display: "flex", justifyContent: "flex-start", margin: "8px 0" }}>
          <div style={{
            maxWidth: "92%",
            background: "#f5f4f0",
            borderRadius: "16px 16px 16px 4px",
            padding: "12px 16px"
          }}>
            {resp.reasoning && <ReasoningBlock text={resp.reasoning} />}
            {resp.content && (
              <div style={{
                fontSize: 13, color: "#333", lineHeight: 1.6,
                whiteSpace: "pre-wrap", wordBreak: "break-word"
              }}>
                {resp.content}
              </div>
            )}
            {resp.tool_calls && resp.tool_calls.map((tc, j) => (
              <ToolCallBlock key={`resp-tc-${j}`} tc={tc} />
            ))}
          </div>
        </div>
      )}

      {/* Final attempt failure (right-aligned, red — matching retry style) */}
      {retries && retries.length > 0 && error && (
        <div style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0" }}>
          <div style={{
            maxWidth: "85%",
            background: "#fcebeb", borderRadius: "16px 16px 4px 16px",
            padding: "10px 16px", border: "1px solid #f0c5c5"
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: "#a32d2d",
              textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4
            }}>
              Attempt {totalAttempts} of {totalAttempts} — {error}
            </div>
            <div style={{ fontSize: 12, color: "#791f1f", lineHeight: 1.5 }}>
              This was the final attempt.
            </div>
          </div>
        </div>
      )}

      {/* Error (skip if already shown in final attempt block above) */}
      {error && !retries && (
        <div style={{
          background: "#fcebeb", borderLeft: "3px solid #E24B4A", padding: "12px 16px",
          borderRadius: "0 8px 8px 0", margin: "8px 0", fontSize: 13, lineHeight: 1.6,
          color: "#791f1f", whiteSpace: "pre-wrap", wordBreak: "break-word"
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#a32d2d", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Error</div>
          {error}
        </div>
      )}
    </div>
  );
}
