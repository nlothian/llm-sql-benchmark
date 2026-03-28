import { LimitErrorBlock, parseLimitError } from "./shared.jsx";
import CallDetail from "./CallDetail.jsx";

export default function ConversationTrace({ trace, defaultOpen }) {
  const { calls, systemPrompt, error } = trace || {};
  if (!calls || calls.length === 0) return null;

  const limit = parseLimitError(error);
  const maxCalls = limit?.maxCalls ?? null;

  return (
    <details open={defaultOpen} style={{ marginTop: 16 }}>
      <summary style={{
        fontSize: 13, fontWeight: 600, color: "#534ab7", cursor: "pointer",
        padding: "8px 0", userSelect: "none"
      }}>
        View full conversation ({calls.length} LLM calls)
      </summary>
      <div style={{ marginTop: 12 }}>
        {systemPrompt && (
          <div style={{ marginBottom: 16, padding: 12, background: "#f8f7f5", borderRadius: 8, border: "1px solid #e8e6e0" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
              System prompt
            </div>
            <pre style={{ fontSize: 12, color: "#444", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "'SF Mono', 'Fira Code', monospace", lineHeight: 1.5 }}>
              {systemPrompt}
            </pre>
          </div>
        )}
        {calls.map((call, i) => (
          <CallDetail key={i} call={call} index={i} totalCalls={calls.length} maxCalls={maxCalls} />
        ))}
        {limit && (
          <LimitErrorBlock limit={limit} />
        )}
      </div>
    </details>
  );
}
