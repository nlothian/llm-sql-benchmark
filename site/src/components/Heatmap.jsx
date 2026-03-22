import { useEffect, useMemo, useState } from "react";

const DIFF_ORDER = ["trivial", "easy", "medium", "hard"];

const DIFF_COLORS = {
  trivial: { bg: "#e6f4e8", text: "#2d6e36", border: "#97C459" },
  easy: { bg: "#e1f5ee", text: "#0f6e56", border: "#5DCAA5" },
  medium: { bg: "#e6f1fb", text: "#185fa5", border: "#85B7EB" },
  hard: { bg: "#eeedfe", text: "#534ab7", border: "#AFA9EC" },
};

const STATUS_COLORS = {
  pass: "#5cb85c",
  fail: "#e06060",
  error: "#f0a030",
};

export default function Heatmap() {
  const [benchmarks, setBenchmarks] = useState(null);
  const [error, setError] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [prefixFilter, setPrefixFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");

  useEffect(() => {
    fetch("/data/index.json")
      .then(r => r.json())
      .then(data => setBenchmarks(data.benchmarks))
      .catch(() => setError("Failed to load benchmark data."));
  }, []);

  // Derive question order (grouped by difficulty) and model rows
  const { questions, models, passRates } = useMemo(() => {
    if (!benchmarks || benchmarks.length === 0) return { questions: [], models: [], passRates: {} };

    // Get questions from first benchmark, build lookup
    const qMap = {};
    benchmarks[0].results.forEach(r => {
      qMap[r.id] = { id: r.id, difficulty: r.difficulty };
    });

    // Group and sort by difficulty order, then by id within group
    const grouped = DIFF_ORDER.flatMap(diff =>
      Object.values(qMap)
        .filter(q => q.difficulty === diff)
        .sort((a, b) => a.id - b.id)
    );

    // Models sorted by passed desc, then alphabetically
    const sorted = [...benchmarks].sort((a, b) => {
      if (b.passed !== a.passed) return b.passed - a.passed;
      return a.model.localeCompare(b.model);
    });

    // Build status lookup per model
    const modelRows = sorted.map(b => {
      const statusMap = {};
      b.results.forEach(r => { statusMap[r.id] = r.status; });
      return {
        id: b.id,
        model: b.model,
        modelVariant: b.modelVariant,
        passed: b.passed,
        total: b.total,
        statusMap,
      };
    });

    // Per-question pass rate
    const rates = {};
    grouped.forEach(q => {
      const passing = benchmarks.filter(b =>
        b.results.find(r => r.id === q.id)?.status === "pass"
      ).length;
      rates[q.id] = Math.round((passing / benchmarks.length) * 100);
    });

    return { questions: grouped, models: modelRows, passRates: rates };
  }, [benchmarks]);

  // Difficulty group spans for header
  const diffGroups = useMemo(() => {
    const groups = [];
    let currentDiff = null;
    let count = 0;
    questions.forEach(q => {
      if (q.difficulty !== currentDiff) {
        if (currentDiff) groups.push({ diff: currentDiff, span: count });
        currentDiff = q.difficulty;
        count = 1;
      } else {
        count++;
      }
    });
    if (currentDiff) groups.push({ diff: currentDiff, span: count });
    return groups;
  }, [questions]);

  const getPrefix = (m) => {
    const parts = m.split("/");
    return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
  };

  const shortModel = (m) => {
    const parts = m.split("/");
    const last = parts[parts.length - 1];
    const [name, tag] = last.split(":");
    return tag === "free" ? `${name}:free` : name;
  };

  const prefixes = useMemo(() => {
    const set = new Set(models.map(m => getPrefix(m.model)));
    return ["", ...Array.from(set).filter(Boolean).sort()];
  }, [models]);

  const filteredModels = useMemo(() => {
    let filtered = models;
    if (prefixFilter) {
      filtered = filtered.filter(m => getPrefix(m.model) === prefixFilter);
    }
    if (nameFilter) {
      const lc = nameFilter.toLowerCase();
      filtered = filtered.filter(m => shortModel(m.model).toLowerCase().includes(lc));
    }
    return filtered;
  }, [models, prefixFilter, nameFilter]);

  const CELL_W = "var(--heatmap-cell-w)";
  const CELL_H = 20;
  const LABEL_W = 180;
  const SCORE_W = 52;
  const FONT = "'Geist', 'SF Pro Display', -apple-system, sans-serif";

  if (error) {
    return (
      <div style={{ fontFamily: FONT, maxWidth: 900, margin: "0 auto", padding: "60px 16px", textAlign: "center", color: "#a32d2d" }}>
        {error}
      </div>
    );
  }

  if (!benchmarks) {
    return (
      <div style={{ fontFamily: FONT, maxWidth: 900, margin: "0 auto", padding: "60px 16px", textAlign: "center", color: "#999" }}>
        Loading heatmap data...
      </div>
    );
  }

  return (
    <div className="heatmap-panel" style={{ fontFamily: FONT, maxWidth: 900, margin: "0 auto", padding: "24px 16px", color: "#1a1a1a" }}>
      {/* Legend */}
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px", letterSpacing: -0.3 }}>
        Model Heatmap
      </h2>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, fontSize: 12 }}>
        {[
          { label: "Pass", color: STATUS_COLORS.pass },
          { label: "Fail", color: STATUS_COLORS.fail },
          { label: "Error", color: STATUS_COLORS.error },
        ].map(l => (
          <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: l.color, display: "inline-block" }} />
            {l.label}
          </span>
        ))}
      </div>

      <div style={{
        width: "max(100%, calc(100% + ((100vw - 900px) / 2)))",
        overflowX: "auto",
        position: "relative",
      }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 2, whiteSpace: "nowrap", tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            <col style={{ width: LABEL_W }} />
            <col style={{ width: SCORE_W }} />
            {questions.map(q => (
              <col key={q.id} style={{ width: CELL_W }} />
            ))}
          </colgroup>
          <thead>
            {/* Difficulty group header */}
            <tr>
              <th style={{ width: LABEL_W, verticalAlign: "bottom", paddingBottom: 2 }}>
                <div style={{ display: "flex", width: "100%", boxSizing: "border-box" }}>
                  <select
                    value={prefixFilter}
                    onChange={e => setPrefixFilter(e.target.value)}
                    style={{
                      fontSize: 11, padding: "3px 4px",
                      border: "1px solid #ddd", borderRight: "none",
                      borderRadius: "4px 0 0 4px",
                      outline: "none", fontFamily: "inherit",
                      color: "#444", background: "#fafafa",
                      flexShrink: 0,
                    }}
                  >
                    {prefixes.map(p => (
                      <option key={p} value={p}>{p || "All"}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={nameFilter}
                    onChange={e => setNameFilter(e.target.value)}
                    placeholder="Filter..."
                    style={{
                      flex: 1, minWidth: 0, boxSizing: "border-box",
                      fontSize: 11, padding: "3px 6px",
                      border: "1px solid #ddd", borderRadius: "0 4px 4px 0",
                      outline: "none", fontFamily: "inherit",
                      color: "#444", background: "#fafafa",
                    }}
                  />
                </div>
              </th>
              <th style={{ width: SCORE_W, fontSize: 10, color: "#999", fontWeight: 600, textAlign: "center" }}>score</th>
              {diffGroups.map(g => {
                const dc = DIFF_COLORS[g.diff];
                return (
                  <th
                    key={g.diff}
                    colSpan={g.span}
                    style={{
                      fontSize: 11, fontWeight: 600, textAlign: "center",
                      color: dc.text, fontStyle: "italic",
                      padding: "4px 0",
                    }}
                  >
                    {g.diff}
                  </th>
                );
              })}
            </tr>
            {/* Question ID header */}
            <tr>
              <th />
              <th />
              {questions.map(q => (
                <th key={q.id} style={{
                  fontSize: 10, fontWeight: 500, color: "#999", textAlign: "center",
                  width: CELL_W, padding: "2px 0", overflow: "hidden",
                }}>
                  Q{q.id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredModels.map(m => (
              <tr key={m.id}>
                <td
                  title={m.model + (m.modelVariant ? ` (${m.modelVariant})` : '')}
                  style={{
                    fontSize: 12, fontWeight: 600, color: "#444", textAlign: "right",
                    paddingRight: 10, maxWidth: LABEL_W, overflow: "hidden", textOverflow: "ellipsis",
                    cursor: "default",
                  }}
                >
                  {shortModel(m.model)}{m.modelVariant ? ` (${m.modelVariant})` : ''}
                </td>
                <td style={{
                  fontSize: 12, fontWeight: 600, color: "#666", textAlign: "center",
                  padding: "0 4px",
                }}>
                  {m.passed}/{m.total}
                </td>
                {questions.map(q => {
                  const status = m.statusMap[q.id] || "error";
                  const bg = STATUS_COLORS[status] || STATUS_COLORS.error;
                  return (
                    <td
                      key={q.id}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip({
                          model: m.model,
                          modelVariant: m.modelVariant,
                          questionId: q.id,
                          difficulty: q.difficulty,
                          status,
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                        });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        width: CELL_W, height: CELL_H,
                        background: bg,
                        borderRadius: 3,
                        cursor: "default",
                      }}
                    />
                  );
                })}
              </tr>
            ))}
            {/* Pass rate row */}
            <tr>
              <td style={{ fontSize: 11, color: "#999", textAlign: "right", paddingRight: 10, paddingTop: 6 }}>
                pass rate
              </td>
              <td />
              {questions.map(q => (
                <td key={q.id} style={{
                  position: "relative",
                  width: CELL_W, padding: 0, overflow: "hidden",
                }}>
                  <span style={{
                    position: "absolute",
                    left: "50%", top: 6,
                    transform: "translateX(-50%)",
                    fontSize: 8, fontWeight: 500, color: "#999",
                    whiteSpace: "nowrap",
                  }}>
                    {passRates[q.id]}%
                  </span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        {/* Tooltip (fixed position) */}
        {tooltip && (
          <div style={{
            position: "fixed",
            left: tooltip.x,
            top: tooltip.y - 8,
            transform: "translate(-50%, -100%)",
            background: "#fff",
            border: "1px solid #e8e6e0",
            borderRadius: 8,
            padding: "8px 12px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            pointerEvents: "none",
            zIndex: 100,
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: "nowrap",
          }}>
            <div style={{ fontWeight: 700, color: "#1a1a1a", marginBottom: 2 }}>{shortModel(tooltip.model)}{tooltip.modelVariant ? ` (${tooltip.modelVariant})` : ''}</div>
            <div style={{ color: "#666" }}>
              Q{tooltip.questionId} · {tooltip.difficulty} ·{" "}
              <span style={{ fontWeight: 600, color: STATUS_COLORS[tooltip.status] }}>
                {tooltip.status}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
