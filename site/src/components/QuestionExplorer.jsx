import { useState, useEffect, useMemo } from "react";
import { fetchGz } from "./fetchGz.js";
import SqlRunner from "./SqlRunner.jsx";

const DIFF_COLORS = {
  trivial: { bg: "#e6f4e8", text: "#2d6e36", border: "#97C459" },
  easy: { bg: "#e1f5ee", text: "#0f6e56", border: "#5DCAA5" },
  medium: { bg: "#e6f1fb", text: "#185fa5", border: "#85B7EB" },
  hard: { bg: "#eeedfe", text: "#534ab7", border: "#AFA9EC" },
};

function DiffBadge({ diff }) {
  const c = DIFF_COLORS[diff] || DIFF_COLORS.medium;
  return (
    <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 6, background: c.bg, color: c.text, fontWeight: 500 }}>
      {diff}
    </span>
  );
}

function TableBadge({ name }) {
  return (
    <span style={{
      fontSize: 11, padding: "2px 10px", borderRadius: 6,
      background: "#f0f0ed", color: "#666", fontWeight: 500,
      fontFamily: "'JetBrains Mono', monospace"
    }}>
      {name}
    </span>
  );
}

function QuestionCard({ question, isOpen, onToggle }) {
  const { id, difficulty, sql, included_tables, rowCount } = question;

  return (
    <div style={{
      borderRadius: 10, marginBottom: 8, overflow: "hidden",
      border: "1px solid #e8e6e0", background: "#fff",
      transition: "all 0.15s ease"
    }}>
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
          cursor: "pointer", userSelect: "none", flexWrap: "wrap"
        }}
      >
        <span style={{
          fontFamily: "monospace", fontWeight: 700, fontSize: 14,
          color: "#666", minWidth: 32
        }}>Q{id}</span>
        <DiffBadge diff={difficulty} />
        <span style={{
          flex: 1, fontSize: 13, color: "#555", overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 120
        }}>
          {question.question}
        </span>
        <span style={{ fontSize: 12, color: "#999", whiteSpace: "nowrap" }}>
          {rowCount} {rowCount === 1 ? "row" : "rows"}
        </span>
        <span style={{ fontSize: 12, color: "#999", whiteSpace: "nowrap" }}>
          {included_tables.length} {included_tables.length === 1 ? "table" : "tables"}
        </span>
        <span style={{
          fontSize: 16, color: "#bbb", transition: "transform 0.2s",
          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)"
        }}>▾</span>
      </div>

      {isOpen && (
        <div style={{ borderTop: "1px solid #eee", padding: "16px 20px", background: "#fafaf8" }}>
          <div style={{ fontSize: 13, color: "#444", lineHeight: 1.7, marginBottom: 16 }}>
            {question.question}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: "#888", marginBottom: 6,
              textTransform: "uppercase", letterSpacing: 0.5
            }}>
              Tables used
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {included_tables.map(t => <TableBadge key={t} name={t} />)}
            </div>
          </div>

          <SqlRunner tables={included_tables} defaultSql={sql} title="Canonical SQL" />
        </div>
      )}
    </div>
  );
}

export default function QuestionExplorer({ showTitle = true }) {
  const [data, setData] = useState(null);
  const [openQ, setOpenQ] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetchGz("/data/answers.json")
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData({ questions: [] }));
  }, []);

  const byDiff = useMemo(() => {
    if (!data) return {};
    const groups = {};
    data.questions.forEach(q => {
      if (!groups[q.difficulty]) groups[q.difficulty] = 0;
      groups[q.difficulty]++;
    });
    return groups;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data.questions;
    return data.questions.filter(q => q.difficulty === filter);
  }, [filter, data]);

  const diffOrder = ["trivial", "easy", "medium", "hard"];

  if (!data) {
    return (
      <div style={{ fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", margin: "0 auto", padding: "60px 16px", textAlign: "center", color: "#999" }}>
        Loading questions...
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", margin: "0 auto", padding: "24px 16px", color: "#1a1a1a" }}>
      {showTitle !== false && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px", letterSpacing: -0.3 }}>
            {typeof showTitle === "string" ? showTitle : "Benchmark Questions"}
          </h2>
          <div style={{ fontSize: 13, color: "#999" }}>
            {data.questions.length} questions across {Object.keys(byDiff).length} difficulty levels
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { key: "all", label: "All" },
          ...diffOrder.map(d => ({ key: d, label: d.charAt(0).toUpperCase() + d.slice(1) }))
        ].map(f => {
          const isActive = filter === f.key;
          const dc = f.key !== "all" ? DIFF_COLORS[f.key] : null;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                fontSize: 12, padding: "5px 14px", borderRadius: 6,
                border: `1px solid ${dc ? dc.border : "#ddd"}`,
                background: dc ? dc.bg : (isActive ? "#1a1a1a" : "#fff"),
                color: dc ? dc.text : (isActive ? "#fff" : "#666"),
                opacity: isActive ? 1 : 0.55,
                cursor: "pointer", fontWeight: 500, transition: "all 0.15s"
              }}
            >
              {f.label}
              {f.key !== "all" && byDiff[f.key] && ` (${byDiff[f.key]})`}
            </button>
          );
        })}
      </div>

      <div>
        {filtered.map(q => (
          <QuestionCard
            key={q.id}
            question={q}
            isOpen={openQ === q.id}
            onToggle={() => setOpenQ(openQ === q.id ? null : q.id)}
          />
        ))}
      </div>
    </div>
  );
}
