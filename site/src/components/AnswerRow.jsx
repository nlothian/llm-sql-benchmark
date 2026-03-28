import { DIFF_COLORS } from "./shared.jsx";
import AnswerDetail from "./AnswerDetail.jsx";

const STATUS_COLORS = {
  pass: { bg: "#e6f4e8", text: "#2d6e36" },
  fail: { bg: "#fcebeb", text: "#a32d2d" },
  error: { bg: "#faeeda", text: "#854f0b" },
};

export function DiffBadge({ diff }) {
  const c = DIFF_COLORS[diff] || DIFF_COLORS.medium;
  return (
    <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 6, background: c.bg, color: c.text, fontWeight: 500 }}>
      {diff}
    </span>
  );
}

export function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.error;
  return (
    <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 6, background: c.bg, color: c.text, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
      {status}
    </span>
  );
}

export default function AnswerRow({ result, isOpen, onToggle, systemPrompt, referenceSql, includedTables }) {
  const { id, question, difficulty, status, durationMs, attempts, sql, cost, check, calls, error } = result;

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
        <AnswerDetail
          question={question}
          sql={sql}
          referenceSql={referenceSql}
          includedTables={includedTables}
          check={check}
          calls={calls}
          error={error}
          systemPrompt={systemPrompt}
        />
      )}
    </div>
  );
}
