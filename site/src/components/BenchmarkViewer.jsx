import { useState, useEffect, useMemo, useCallback } from "react";
import { parseJsonlText } from "./parseLogData.js";


/**
 * Parse a benchmark error string into structured limit information.
 * Returns null if the error doesn't match a known limit pattern.
 */
function parseLimitError(error) {
  if (!error) return null;

  const sqlRetryMatch = error.match(/^Query failed after (\d+) retries: (.+)$/s);
  if (sqlRetryMatch) {
    const maxRetries = parseInt(sqlRetryMatch[1], 10);
    return {
      type: "sql-retries",
      label: "SQL retry limit reached",
      detail: `${maxRetries + 1} of ${maxRetries + 1} SQL attempts used`,
      sqlError: sqlRetryMatch[2],
    };
  }

  const toolCallMatch = error.match(/^Exceeded maximum tool calls \((\d+)\)$/);
  if (toolCallMatch) {
    const max = parseInt(toolCallMatch[1], 10);
    return {
      type: "tool-calls",
      label: "Tool call limit reached",
      detail: `${max} of ${max} LLM calls used`,
      maxCalls: max,
      sqlError: null,
    };
  }

  const noToolCallMatch = error.match(/^No tool call in response after (\d+) attempts$/);
  if (noToolCallMatch) {
    const max = parseInt(noToolCallMatch[1], 10);
    return {
      type: "no-tool-call",
      label: "Tool call retry limit reached",
      detail: `Model failed to produce a tool call in ${max} consecutive attempts`,
      sqlError: null,
    };
  }

  return null;
}

const DIFF_COLORS = {
  trivial: { bg: "#e6f4e8", text: "#2d6e36", border: "#97C459" },
  easy: { bg: "#e1f5ee", text: "#0f6e56", border: "#5DCAA5" },
  medium: { bg: "#e6f1fb", text: "#185fa5", border: "#85B7EB" },
  hard: { bg: "#eeedfe", text: "#534ab7", border: "#AFA9EC" },
};

const STATUS_COLORS = {
  pass: { bg: "#e6f4e8", text: "#2d6e36" },
  fail: { bg: "#fcebeb", text: "#a32d2d" },
  error: { bg: "#faeeda", text: "#854f0b" },
};

function DiffBadge({ diff }) {
  const c = DIFF_COLORS[diff] || DIFF_COLORS.medium;
  return (
    <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 6, background: c.bg, color: c.text, fontWeight: 500 }}>
      {diff}
    </span>
  );
}

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.error;
  return (
    <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 6, background: c.bg, color: c.text, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
      {status}
    </span>
  );
}

function MetricCard({ label, value, sub, accent }) {
  return (
    <div style={{ flex: "1 1 140px", background: "#f8f7f5", borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 4, letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: accent || "#1a1a1a", lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function CodeBlock({ code, language }) {
  return (
    <pre style={{
      background: "#1e1e2e", color: "#cdd6f4", padding: "14px 16px", borderRadius: 8,
      fontSize: 12.5, lineHeight: 1.6, overflowX: "auto", margin: "8px 0",
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      border: "1px solid #313244", whiteSpace: "pre-wrap", wordBreak: "break-word"
    }}>
      <code>{code}</code>
    </pre>
  );
}

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
    <div style={{
      background: "#f0faf5", borderLeft: "3px solid #5DCAA5", padding: "12px 16px",
      borderRadius: "0 8px 8px 0", margin: "8px 0", fontSize: 12.5, lineHeight: 1.6,
      color: "#1a4a3a", whiteSpace: "pre-wrap", wordBreak: "break-word",
      fontFamily: "'JetBrains Mono', monospace"
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#0f6e56", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Tool result</div>
      {content}
    </div>
  );
}

function RetryAttemptBlock({ retry, attemptIndex, totalAttempts }) {
  return (
    <div style={{
      background: "#fef9ee", border: "1px solid #e8d5a0", borderRadius: 8,
      padding: "10px 14px", marginBottom: 8, fontSize: 13
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: "#854f0b",
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6,
        display: "flex", alignItems: "center", gap: 6
      }}>
        <span style={{
          background: "#faeeda", padding: "2px 8px", borderRadius: 4
        }}>tool_call try {attemptIndex + 1} of {totalAttempts}</span>
        {retry.error || "No tool call in response"}
      </div>
      {retry.resp?.content && (
        <div style={{ color: "#6b5a2e", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {retry.resp.content}
        </div>
      )}
      {retry.resp?.reasoning && <ReasoningBlock text={retry.resp.reasoning} />}
    </div>
  );
}

function CallDetail({ call, index, totalCalls, maxCalls }) {
  const { req, resp, retries, error } = call;
  const totalAttempts = retries ? retries.length + 1 : 1;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 10,
        textTransform: "uppercase", letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 8
      }}>
        <span style={{
          width: 22, height: 22, borderRadius: "50%", background: "#eeedfe",
          color: "#534ab7", display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700
        }}>{index + 1}</span>
        LLM call {index + 1} of {maxCalls || totalCalls}
        {resp?.usage && (
          <span style={{ fontWeight: 400, fontSize: 11, color: "#aaa" }}>
            {resp.usage.prompt_tokens}→{resp.usage.completion_tokens} tokens
          </span>
        )}
        {retries && retries.length > 0 && (
          <span style={{ fontSize: 11, background: "#faeeda", color: "#854f0b", padding: "2px 8px", borderRadius: 6, fontWeight: 500 }}>
            {retries.length} {retries.length === 1 ? "retry" : "retries"}
          </span>
        )}
      </div>

      {retries && retries.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {retries.map((retry, ri) => (
            <RetryAttemptBlock key={`retry-${ri}`} retry={retry} attemptIndex={ri} totalAttempts={totalAttempts} />
          ))}
        </div>
      )}

      {req && req.map((m, i) => {
        if (m.role === "user") {
          return (
            <div key={i} style={{
              background: "#f0f4ff", borderRadius: 8, padding: "10px 14px",
              margin: "6px 0", fontSize: 13, color: "#2a4a8a", lineHeight: 1.6
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#5577bb", textTransform: "uppercase", letterSpacing: 0.4 }}>User </span>
              {m.content}
            </div>
          );
        }
        if (m.role === "assistant" && m.tool_calls) {
          return m.tool_calls.map((tc, j) => <ToolCallBlock key={`tc-${i}-${j}`} tc={tc} />);
        }
        if (m.role === "tool") {
          return <ToolResultBlock key={i} content={m.content} />;
        }
        return null;
      })}

      {resp && (
        <div style={{ marginTop: 8 }}>
          {resp.reasoning && <ReasoningBlock text={resp.reasoning} />}
          {resp.tool_calls && resp.tool_calls.map((tc, j) => (
            <ToolCallBlock key={`resp-tc-${j}`} tc={tc} />
          ))}
          {resp.content && (
            <div style={{
              background: "#f8f7f5", borderRadius: 8, padding: "10px 14px",
              margin: "6px 0", fontSize: 13, color: "#333", lineHeight: 1.6
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 }}>Response </span>
              {resp.content}
            </div>
          )}
        </div>
      )}

      {error && (
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

function LimitErrorBlock({ limit, style }) {
  return (
    <div style={{
      background: "#fcebeb", borderRadius: 8, padding: "10px 14px",
      fontSize: 13, lineHeight: 1.6, border: "1.5px solid #f09595", color: "#791f1f",
      ...style,
    }}>
      <div style={{ fontWeight: 600, color: "#a32d2d", marginBottom: 2 }}>{limit.label}</div>
      <div style={{ fontSize: 12, color: "#994040" }}>{limit.detail}</div>
      {limit.sqlError && (
        <div style={{ marginTop: 6, padding: "6px 10px", background: "#f8dada", borderRadius: 6, fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
          {limit.sqlError}
        </div>
      )}
    </div>
  );
}

function QuestionRow({ result, isOpen, onToggle, systemPrompt }) {
  const { id, question, difficulty, status, durationMs, attempts, sql, cost, check, calls, error } = result;
  const diffs = check?.firstRowDiffs || [];
  const limit = parseLimitError(error);
  const maxCalls = limit?.maxCalls ?? null;

  return (
    <div style={{
      borderRadius: 10, marginBottom: 8, overflow: "hidden",
      border: status === "fail" ? "1.5px solid #f09595" : "1px solid #e8e6e0",
      background: status === "fail" ? "#fffbfb" : "#fff",
      transition: "all 0.15s ease"
    }}>
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
          cursor: "pointer", userSelect: "none",
          flexWrap: "wrap"
        }}
      >
        <span style={{
          fontFamily: "monospace", fontWeight: 700, fontSize: 14,
          color: "#666", minWidth: 32
        }}>Q{id}</span>
        <DiffBadge diff={difficulty} />
        <StatusBadge status={status} />
        <span style={{ flex: 1, fontSize: 13, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 120 }}>
          {question}
        </span>
        <span style={{ fontSize: 12, color: "#999", whiteSpace: "nowrap" }}>
          {(durationMs / 1000).toFixed(1)}s
        </span>
        <span style={{ fontSize: 12, color: "#999", whiteSpace: "nowrap" }}>
          ${(cost ?? 0).toFixed(4)}
        </span>
        {attempts > 1 && (
          <span style={{ fontSize: 11, background: "#faeeda", color: "#854f0b", padding: "2px 8px", borderRadius: 6 }}>
            {attempts} attempts
          </span>
        )}
        <span style={{
          fontSize: 16, color: "#bbb", transition: "transform 0.2s",
          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)"
        }}>▾</span>
      </div>

      {isOpen && (
        <div style={{ borderTop: "1px solid #eee", padding: "16px 20px", background: "#fafaf8" }}>
          <div style={{ fontSize: 13, color: "#444", lineHeight: 1.7, marginBottom: 16 }}>
            {question}
          </div>

          {diffs.length > 0 && (
            <div style={{
              background: "#fcebeb", borderRadius: 8, padding: "10px 14px",
              marginBottom: 14, fontSize: 12
            }}>
              <span style={{ fontWeight: 600, color: "#a32d2d" }}>Mismatches: </span>
              {diffs.map((d, i) => (
                <span key={i} style={{ color: "#791f1f" }}>
                  {d.column} (expected {typeof d.expected === "number" ? d.expected : JSON.stringify(d.expected)}, got {typeof d.actual === "number" ? d.actual : JSON.stringify(d.actual)})
                  {i < diffs.length - 1 ? " · " : ""}
                </span>
              ))}
            </div>
          )}

          {error && limit && (
            <LimitErrorBlock limit={limit} style={{ marginBottom: 14 }} />
          )}
          {error && !limit && (
            <div style={{
              background: "#fcebeb", borderRadius: 8, padding: "10px 14px",
              marginBottom: 14, fontSize: 13, lineHeight: 1.6,
              border: "1.5px solid #f09595", color: "#791f1f"
            }}>
              <span style={{ fontWeight: 600, color: "#a32d2d" }}>Error: </span>
              {error}
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 600, color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Final SQL
          </div>
          <CodeBlock code={sql} language="sql" />

          {calls && calls.length > 0 && (
            <details style={{ marginTop: 16 }}>
              <summary style={{
                fontSize: 13, fontWeight: 600, color: "#534ab7", cursor: "pointer",
                padding: "8px 0", userSelect: "none"
              }}>
                View full conversation ({calls.length} LLM calls)
              </summary>
              <div style={{ marginTop: 12, paddingLeft: 4 }}>
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
          )}

          <details style={{ marginTop: 10 }}>
            <summary style={{
              fontSize: 13, fontWeight: 600, color: "#888", cursor: "pointer",
              padding: "8px 0", userSelect: "none"
            }}>
              Check details
            </summary>
            <CodeBlock code={JSON.stringify(check, null, 2)} />
          </details>
        </div>
      )}
    </div>
  );
}

function BarChart({ data, height, valueKey, formatValue, colorFn }) {
  const max = Math.max(...data.map(d => d[valueKey]));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height, padding: "0 0 24px" }}>
      {data.map((d, i) => {
        const h = max > 0 ? (d[valueKey] / max) * (height - 40) : 0;
        const c = colorFn(d);
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={{ fontSize: 10, color: "#aaa", fontFamily: "monospace" }}>{formatValue(d[valueKey])}</div>
            <div style={{
              width: "100%", height: Math.max(h, 2), borderRadius: "4px 4px 0 0",
              background: c.bg, border: `1.5px solid ${c.border}`,
              transition: "height 0.3s ease"
            }} />
            <div style={{ fontSize: 10, color: "#999", fontFamily: "monospace" }}>Q{d.id}</div>
          </div>
        );
      })}
    </div>
  );
}

function BenchmarkDashboard({ data, onClear }) {
  const [openQ, setOpenQ] = useState(null);
  const [filter, setFilter] = useState("all");

  const { meta, summary, results } = data;

  const byDiff = useMemo(() => {
    const groups = {};
    results.forEach(r => {
      if (!groups[r.difficulty]) groups[r.difficulty] = { total: 0, passed: 0 };
      groups[r.difficulty].total++;
      if (r.status === "pass") groups[r.difficulty].passed++;
    });
    return groups;
  }, [results]);

  const filtered = useMemo(() => {
    if (filter === "all") return results;
    if (filter === "fail") return results.filter(r => r.status === "fail");
    return results.filter(r => r.difficulty === filter);
  }, [filter, results]);

  const colorFn = (d) => {
    if (d.status === "fail") return { bg: "#fcebeb", border: "#E24B4A" };
    const dc = DIFF_COLORS[d.difficulty];
    return { bg: dc.bg, border: dc.border };
  };

  const diffOrder = ["trivial", "easy", "medium", "hard"];

  return (
    <div style={{ fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", maxWidth: 900, margin: "0 auto", padding: "24px 16px", color: "#1a1a1a" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 4px" }}>
          <span
            onClick={onClear}
            style={{ fontSize: 22, color: "#999", cursor: "pointer", lineHeight: 1, userSelect: "none" }}
            onMouseEnter={e => { e.currentTarget.style.color = "#333"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#999"; }}
          >
            ‹
          </span>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>
            {meta.model}{meta.modelVariant ? <span style={{ fontWeight: 400, color: "#888", fontSize: 16 }}>{` (${meta.modelVariant})`}</span> : ''}
          </h1>
        </div>
        <div style={{ fontSize: 13, color: "#999", marginLeft: 30 }}>
          {meta.endpoint} · {new Date(meta.timestamp).toLocaleString()}
          {meta.modelVariant && <> · Variant: {meta.modelVariant}</>}
          {meta.throttleTimeSec != null && <> · Throttled ({meta.throttleTimeSec}s)</>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        <MetricCard
          label="Pass rate"
          value={`${Math.round(summary.passed / summary.total * 100)}%`}
          sub={`${summary.passed} / ${summary.total} questions`}
          accent={summary.passed === summary.total ? "#2d6e36" : "#1a1a1a"}
        />
        <MetricCard
          label="Failures"
          value={summary.failed}
          sub={summary.failed > 0 ? results.filter(r => r.status === "fail").map(r => `Q${r.id}`).join(", ") : "None"}
          accent={summary.failed > 0 ? "#a32d2d" : "#2d6e36"}
        />
        <MetricCard
          label="Total cost"
          value={summary.totalCost != null ? `$${summary.totalCost.toFixed(3)}` : "N/A"}
          sub={`${(summary.totalInputTokens / 1000).toFixed(1)}k in · ${(summary.totalOutputTokens / 1000).toFixed(1)}k out`}
        />
        <MetricCard
          label="Avg latency"
          value={`${(results.reduce((s, r) => s + r.durationMs, 0) / results.length / 1000).toFixed(1)}s`}
          sub={`${(Math.min(...results.map(r => r.durationMs)) / 1000).toFixed(1)}s – ${(Math.max(...results.map(r => r.durationMs)) / 1000).toFixed(1)}s`}
        />
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {diffOrder.map(d => {
          const g = byDiff[d];
          if (!g) return null;
          const dc = DIFF_COLORS[d];
          return (
            <div key={d} style={{
              flex: "1 1 80px", textAlign: "center", borderRadius: 8,
              padding: "10px 8px", background: dc.bg, border: `1.5px solid ${dc.border}40`
            }}>
              <div style={{ fontSize: 11, color: dc.text, opacity: 0.8, textTransform: "capitalize" }}>{d}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: dc.text }}>
                {g.passed}/{g.total}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#888", marginBottom: 8 }}>
          Latency per question
          {meta.throttleTimeSec != null && (
            <span style={{ fontWeight: 500, fontSize: 12, color: "#999", marginLeft: 8 }}>
              (throttled: {meta.throttleTimeSec}s between calls)
            </span>
          )}
        </div>
        <BarChart
          data={results}
          height={140}
          valueKey="durationMs"
          formatValue={v => (v / 1000).toFixed(0) + "s"}
          colorFn={colorFn}
        />
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { key: "all", label: "All" },
          { key: "fail", label: "Failures" },
          ...diffOrder.map(d => ({ key: d, label: d.charAt(0).toUpperCase() + d.slice(1) }))
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              fontSize: 12, padding: "5px 14px", borderRadius: 6, border: "1px solid #ddd",
              background: filter === f.key ? "#1a1a1a" : "#fff",
              color: filter === f.key ? "#fff" : "#666",
              cursor: "pointer", fontWeight: 500, transition: "all 0.15s"
            }}
          >
            {f.label}
            {f.key !== "all" && f.key !== "fail" && byDiff[f.key] && ` (${byDiff[f.key].total})`}
            {f.key === "fail" && ` (${summary.failed})`}
          </button>
        ))}
      </div>

      <div>
        {filtered.map(r => (
          <QuestionRow
            key={r.id}
            result={r}
            isOpen={openQ === r.id}
            onToggle={() => setOpenQ(openQ === r.id ? null : r.id)}
            systemPrompt={data.systemPrompt}
          />
        ))}
      </div>

      {data.systemPrompt && (
        <div style={{ marginTop: 32, padding: "16px", background: "#f8f7f5", borderRadius: 10 }}>
          <details>
            <summary style={{ fontSize: 13, fontWeight: 600, color: "#888", cursor: "pointer" }}>
              System prompt
            </summary>
            <pre style={{
              fontSize: 12, lineHeight: 1.6, color: "#555", marginTop: 10,
              whiteSpace: "pre-wrap", wordBreak: "break-word"
            }}>
              {data.systemPrompt}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

function BenchmarkPicker({ benchmarks, onSelect }) {
  return (
    <div style={{ fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", maxWidth: 900, margin: "0 auto", padding: "24px 16px", color: "#1a1a1a" }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px", letterSpacing: -0.3 }}>
          Benchmark Results
        </h2>
        <div style={{ fontSize: 13, color: "#999" }}>
          Select a benchmark to view detailed results
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[...benchmarks].sort((a, b) => {
          const rateA = a.total > 0 ? a.passed / a.total : 0;
          const rateB = b.total > 0 ? b.passed / b.total : 0;
          return rateB - rateA || a.model.localeCompare(b.model);
        }).map(b => {
          const passRate = b.total > 0 ? Math.round(b.passed / b.total * 100) : 0;
          return (
            <div
              key={b.id}
              onClick={() => onSelect(b)}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 48px 52px 64px 90px 16px",
                alignItems: "center", gap: 8, padding: "12px 16px",
                borderRadius: 10, border: "1px solid #e8e6e0", background: "#fff",
                cursor: "pointer", transition: "all 0.15s ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "#fafaf8"; e.currentTarget.style.borderColor = "#d0cec8"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "#e8e6e0"; }}
            >
              <span
                title={b.model + (b.modelVariant ? ` (${b.modelVariant})` : '')}
                style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {b.model}{b.modelVariant ? <span style={{ fontWeight: 400, color: "#888" }}>{` (${b.modelVariant})`}</span> : ''}
              </span>
              <span style={{
                fontSize: 13, fontWeight: 600, textAlign: "right",
                color: passRate >= 88 ? "#2d6e36" : passRate >= 72 ? "#185fa5" : "#a32d2d"
              }}>
                {passRate}%
              </span>
              <span style={{ fontSize: 12, color: "#999", textAlign: "right" }}>
                {b.passed}/{b.total}
              </span>
              <span style={{ fontSize: 12, color: "#999", textAlign: "right" }}>
                {b.totalCost != null ? `$${b.totalCost.toFixed(3)}` : ""}
              </span>
              <span style={{ fontSize: 12, color: "#bbb", textAlign: "right" }}>
                {new Date(b.timestamp).toLocaleDateString()}
              </span>
              <span style={{ fontSize: 16, color: "#ccc", textAlign: "right" }}>›</span>
            </div>
          );
        })}
      </div>

    </div>
  );
}

export default function App() {
  const [view, setView] = useState("picker"); // "picker" | "loading" | "dashboard"
  const [index, setIndex] = useState(null);
  const [dashboardData, setDashboardData] = useState(null);
  const [error, setError] = useState(null);

  // Fetch index on mount
  useEffect(() => {
    fetch("/data/index.json")
      .then(r => r.json())
      .then(data => setIndex(data))
      .catch(() => {
        // No index available — show file upload only
        setIndex({ benchmarks: [] });
      });
  }, []);

  const loadBenchmark = useCallback(async (entry) => {
    setView("loading");
    setError(null);
    try {
      const [benchRes, logRes] = await Promise.all([
        fetch(`/data/benchmarks/${entry.benchmarkFile}`),
        entry.logFile ? fetch(`/data/logs/${entry.logFile}`) : Promise.resolve(null),
      ]);
      if (!benchRes.ok) throw new Error(`Failed to load benchmark: ${benchRes.status}`);
      const benchData = await benchRes.json();

      let systemPrompt = null;
      let callsPerQuestion = {};

      if (logRes?.ok) {
        try {
          const logText = await logRes.text();
          const parsed = parseJsonlText(logText);
          systemPrompt = parsed.systemPrompt;
          callsPerQuestion = parsed.callsPerQuestion;
        } catch {
          // Log file failed to parse — continue without calls
        }
      }

      const mergedResults = benchData.results.map(r => ({
        ...r,
        calls: callsPerQuestion[r.id] || [],
      }));

      setDashboardData({
        ...benchData,
        systemPrompt,
        results: mergedResults,
      });
      setView("dashboard");
    } catch (err) {
      setError(err.message || "Failed to load benchmark.");
      setView("picker");
    }
  }, []);

  const handleBack = useCallback(() => {
    setDashboardData(null);
    setView("picker");
  }, []);

  if (!index) {
    return (
      <div style={{ fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", maxWidth: 900, margin: "0 auto", padding: "60px 16px", textAlign: "center", color: "#999" }}>
        Loading benchmarks...
      </div>
    );
  }

  if (view === "loading") {
    return (
      <div style={{ fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", maxWidth: 900, margin: "0 auto", padding: "60px 16px", textAlign: "center", color: "#999" }}>
        Loading benchmark data...
      </div>
    );
  }

  if (view === "dashboard" && dashboardData) {
    return <BenchmarkDashboard data={dashboardData} onClear={handleBack} />;
  }

  return (
    <>
      <BenchmarkPicker
        benchmarks={index.benchmarks}
        onSelect={loadBenchmark}
      />
      {error && (
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 16px" }}>
          <div style={{
            padding: "10px 14px", borderRadius: 8,
            background: "#fcebeb", color: "#a32d2d", fontSize: 13
          }}>
            {error}
          </div>
        </div>
      )}
    </>
  );
}
