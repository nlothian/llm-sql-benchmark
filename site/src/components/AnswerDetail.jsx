import { useState } from "react";
import { CodeBlock, LimitErrorBlock, parseLimitError } from "./shared.jsx";
import CallDetail from "./CallDetail.jsx";

function CheckItem({ label, passed, detail }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 8,
      fontSize: 13, lineHeight: 1.8
    }}>
      <span style={{ fontSize: 15, flexShrink: 0 }}>{passed ? "\u2705" : "\u274C"}</span>
      <span style={{ color: passed ? "#2e7d32" : "#c62828", fontWeight: 500 }}>{label}</span>
      {detail && <span style={{ color: "#888", fontSize: 12 }}>{detail}</span>}
    </div>
  );
}

function DiffTable({ diffs }) {
  if (!diffs || diffs.length === 0) return null;
  const fmt = (v) => typeof v === "number" ? v : JSON.stringify(v);
  const fmtActual = (actual, expected) => {
    const expectedNum = Number(expected);
    const actualNum = Number(actual);
    if (!isNaN(expectedNum) && !isNaN(actualNum)) {
      const expectedStr = String(expected);
      const dotIdx = expectedStr.indexOf(".");
      const decimals = dotIdx === -1 ? 0 : expectedStr.length - dotIdx - 1;
      return Number(actualNum.toFixed(decimals));
    }
    return fmt(actual);
  };
  return (
    <div style={{ marginTop: 10, borderRadius: 8, overflow: "hidden", border: "1px solid #e0ddd5", fontSize: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f5f4f0" }}>
            <th style={{ textAlign: "left", padding: "6px 12px", fontWeight: 600, color: "#666", borderBottom: "1px solid #e0ddd5" }}>Column</th>
            <th style={{ textAlign: "left", padding: "6px 12px", fontWeight: 600, color: "#2e7d32", borderBottom: "1px solid #e0ddd5" }}>Expected</th>
            <th style={{ textAlign: "left", padding: "6px 12px", fontWeight: 600, color: "#c62828", borderBottom: "1px solid #e0ddd5" }}>Actual</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map((d, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafaf8" }}>
              <td style={{ padding: "5px 12px", fontWeight: 500, color: "#333", borderBottom: "1px solid #f0eeea", fontFamily: "'JetBrains Mono', monospace" }}>{d.column}</td>
              <td style={{ padding: "5px 12px", color: "#2e7d32", borderBottom: "1px solid #f0eeea", fontFamily: "'JetBrains Mono', monospace", background: "#f0faf0" }}>{fmt(d.expected)}</td>
              <td style={{ padding: "5px 12px", color: "#c62828", borderBottom: "1px solid #f0eeea", fontFamily: "'JetBrains Mono', monospace", background: "#fef5f5" }}>{fmtActual(d.actual, d.expected)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChecksDetail({ check }) {
  const allPassed = check.rowCountMatch && check.columnCountMatch && check.columnNamesMatch && check.firstRowMatch;
  const diffs = check.firstRowDiffs || [];
  const missingCols = check.missingColumns || [];
  const extraCols = check.extraColumns || [];

  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{
        fontSize: 13, fontWeight: 600,
        color: allPassed ? "#2e7d32" : "#c62828",
        cursor: "pointer",
        padding: "8px 0", userSelect: "none"
      }}>
        {allPassed ? "Checks Passed" : "Checks Failed"}
      </summary>
      <div style={{
        marginTop: 8, padding: "12px 16px",
        background: allPassed ? "#f5faf5" : "#fefaf9",
        borderRadius: 8, border: `1px solid ${allPassed ? "#d4e8d4" : "#f0e0e0"}`
      }}>
        <CheckItem label="Row count" passed={check.rowCountMatch}
          detail={check.actualRowCount != null ? `(${check.actualRowCount} rows)` : null} />
        <CheckItem label="Column count" passed={check.columnCountMatch}
          detail={check.actualColumnCount != null ? `(${check.actualColumnCount} columns)` : null} />
        <CheckItem label="Column names" passed={check.columnNamesMatch}
          detail={
            (missingCols.length > 0 || extraCols.length > 0)
              ? [
                  missingCols.length > 0 ? `missing: ${missingCols.join(", ")}` : null,
                  extraCols.length > 0 ? `extra: ${extraCols.join(", ")}` : null,
                ].filter(Boolean).join(" | ")
              : null
          } />
        <CheckItem label="First row values" passed={check.firstRowMatch} />

        {diffs.length > 0 && <DiffTable diffs={diffs} />}
      </div>
    </details>
  );
}

function ChecksFailedBlock({ check }) {
  const diffs = check.firstRowDiffs || [];
  const missingCols = check.missingColumns || [];
  const extraCols = check.extraColumns || [];

  const failedItems = [];
  if (!check.rowCountMatch)
    failedItems.push(`Row count: expected ${check.actualRowCount != null ? `got ${check.actualRowCount}` : "unknown"}`);
  if (!check.columnCountMatch)
    failedItems.push(`Column count: expected ${check.actualColumnCount != null ? `got ${check.actualColumnCount}` : "unknown"}`);
  if (!check.columnNamesMatch) {
    const parts = [];
    if (missingCols.length > 0) parts.push(`missing: ${missingCols.join(", ")}`);
    if (extraCols.length > 0) parts.push(`extra: ${extraCols.join(", ")}`);
    failedItems.push(`Column names: ${parts.join(" | ")}`);
  }
  if (!check.firstRowMatch) failedItems.push("First row values do not match");

  return (
    <div style={{
      background: "#fcebeb", borderRadius: 8, padding: "10px 14px",
      marginBottom: 14, fontSize: 13, lineHeight: 1.6,
      border: "1.5px solid #f09595", color: "#791f1f"
    }}>
      <div style={{ fontWeight: 600, color: "#a32d2d", marginBottom: 4 }}>Checks Failed</div>
      {failedItems.map((item, i) => (
        <div key={i} style={{ fontSize: 12, color: "#994040" }}>{"\u274C"} {item}</div>
      ))}
      {diffs.length > 0 && <DiffTable diffs={diffs} />}
    </div>
  );
}

export default function AnswerDetail({ question, sql, referenceSql, check, calls, error, systemPrompt, includedTables }) {
  const limit = parseLimitError(error);
  const maxCalls = limit?.maxCalls ?? null;
  const [sqlTab, setSqlTab] = useState(0);

  return (
    <div style={{ borderTop: "1px solid #eee", padding: "16px 20px", background: "#fafaf8" }}>
      <div style={{ fontSize: 13, color: "#444", lineHeight: 1.7, marginBottom: 16 }}>
        {question}
      </div>

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

      {check && !(check.rowCountMatch && check.columnCountMatch && check.columnNamesMatch && check.firstRowMatch) && (
        <ChecksFailedBlock check={check} />
      )}

      {includedTables && includedTables.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: "#888", marginBottom: 6,
            textTransform: "uppercase", letterSpacing: 0.5
          }}>
            Tables used
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {includedTables.map(t => (
              <span key={t} style={{
                fontSize: 11, padding: "2px 10px", borderRadius: 6,
                background: "#f0f0ed", color: "#666", fontWeight: 500,
                fontFamily: "'JetBrains Mono', monospace"
              }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {referenceSql ? (
        <>
          <div style={{ display: "flex", gap: 0, marginBottom: 0 }}>
            {["Model SQL", "Canonical SQL"].map((label, idx) => (
              <button
                key={idx}
                onClick={() => setSqlTab(idx)}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "6px 14px",
                  border: "none",
                  borderBottom: sqlTab === idx ? "2px solid #534ab7" : "2px solid transparent",
                  background: "transparent",
                  color: sqlTab === idx ? "#534ab7" : "#999",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <CodeBlock code={sqlTab === 0 ? sql : referenceSql} language="sql" />
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Final SQL
          </div>
          <CodeBlock code={sql} language="sql" />
        </>
      )}

      {calls && calls.length > 0 && (
        <details style={{ marginTop: 16 }}>
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
      )}

      {check && <ChecksDetail check={check} />}
    </div>
  );
}
