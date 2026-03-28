import { useState, useEffect, useMemo, useCallback } from "react";
import { filterBenchmarks } from "./filterBenchmarks.js";
import { DIFF_COLORS, getPrefix, shortModel, loadBenchmarkWithLogs } from "./shared.jsx";
import AnswerRow from "./AnswerRow.jsx";

function MetricCard({ label, value, sub, accent }) {
  return (
    <div style={{ flex: "1 1 140px", background: "#f8f7f5", borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 4, letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: accent || "#1a1a1a", lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>{sub}</div>}
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

function BenchmarkDashboard({ data, onClear, answersData }) {
  const [openQ, setOpenQ] = useState(null);
  const [filter, setFilter] = useState("all");

  const referenceSqlMap = useMemo(() => {
    if (!answersData?.questions) return {};
    const map = {};
    answersData.questions.forEach(q => { map[q.id] = q.sql; });
    return map;
  }, [answersData]);

  const includedTablesMap = useMemo(() => {
    if (!answersData?.questions) return {};
    const map = {};
    answersData.questions.forEach(q => { map[q.id] = q.included_tables; });
    return map;
  }, [answersData]);

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

  const failedQIds = useMemo(() =>
    summary.failed > 0 ? results.filter(r => r.status === "fail").map(r => `Q${r.id}`).join(", ") : "None",
    [summary.failed, results]
  );

  const colorFn = (d) => {
    if (d.status === "fail") return { bg: "#fcebeb", border: "#E24B4A" };
    const dc = DIFF_COLORS[d.difficulty];
    return { bg: dc.bg, border: dc.border };
  };

  const diffOrder = ["trivial", "easy", "medium", "hard"];

  return (
    <div style={{ fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", margin: "0 auto", padding: "24px 16px", color: "#1a1a1a" }}>
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
          sub={failedQIds}
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
          <AnswerRow
            key={r.id}
            result={r}
            isOpen={openQ === r.id}
            onToggle={() => setOpenQ(openQ === r.id ? null : r.id)}
            systemPrompt={data.systemPrompt}
            referenceSql={referenceSqlMap[r.id] || null}
            includedTables={includedTablesMap[r.id] || null}
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

function BenchmarkPicker({ benchmarks, onSelect, showTitle = true }) {
  const [prefixFilter, setPrefixFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");

  const prefixes = useMemo(() => {
    const set = new Set(benchmarks.map(b => getPrefix(b.model)));
    return ["", ...Array.from(set).filter(Boolean).sort()];
  }, [benchmarks]);

  const filteredBenchmarks = useMemo(() => {
    let filtered = benchmarks;
    if (prefixFilter) {
      filtered = filtered.filter(b => getPrefix(b.model) === prefixFilter);
    }
    if (nameFilter) {
      const lc = nameFilter.toLowerCase();
      filtered = filtered.filter(b => shortModel(b.model).toLowerCase().includes(lc));
    }
    return [...filtered].sort((a, b) => {
      const rateA = a.total > 0 ? a.passed / a.total : 0;
      const rateB = b.total > 0 ? b.passed / b.total : 0;
      return rateB - rateA || a.model.localeCompare(b.model);
    });
  }, [benchmarks, prefixFilter, nameFilter]);

  return (
    <div style={{ fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", margin: "0 auto", padding: "24px 16px", color: "#1a1a1a" }}>
      {showTitle !== false && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px", letterSpacing: -0.3 }}>
            {typeof showTitle === "string" ? showTitle : "Benchmark Results"}
          </h2>
          <div style={{ fontSize: 13, color: "#999" }}>
            Select a benchmark to view detailed results
          </div>
        </div>
      )}

      {showTitle !== false && (
        <div style={{ display: "flex", marginBottom: 12 }}>
          <select
            value={prefixFilter}
            onChange={e => setPrefixFilter(e.target.value)}
            style={{
              fontSize: 12, padding: "6px 8px",
              border: "1px solid #ddd", borderRight: "none",
              borderRadius: "6px 0 0 6px",
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
            placeholder="Filter models..."
            style={{
              flex: 1, minWidth: 0, boxSizing: "border-box",
              fontSize: 12, padding: "6px 10px",
              border: "1px solid #ddd", borderRadius: "0 6px 6px 0",
              outline: "none", fontFamily: "inherit",
              color: "#444", background: "#fafafa",
            }}
          />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filteredBenchmarks.map(b => {
          const passRate = b.total > 0 ? Math.round(b.passed / b.total * 100) : 0;
          return (
            <div
              key={b.id}
              onClick={() => onSelect(b)}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 48px 52px 64px 64px 90px 16px",
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
              <span style={{ fontSize: 12, color: "#999", textAlign: "right" }}>
                {b.results ? `${(b.results.reduce((s, r) => s + r.durationMs, 0) / 1000).toFixed(0)}s` : ""}
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

export default function App({ models, showTitle = true }) {
  const [view, setView] = useState("picker"); // "picker" | "loading" | "dashboard"
  const [index, setIndex] = useState(null);
  const [dashboardData, setDashboardData] = useState(null);
  const [error, setError] = useState(null);
  const [answersData, setAnswersData] = useState(null);

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

  useEffect(() => {
    fetch("/data/answers.json")
      .then(r => r.json())
      .then(d => setAnswersData(d))
      .catch(() => {});
  }, []);

  const loadBenchmark = useCallback(async (entry) => {
    setView("loading");
    setError(null);
    try {
      const { benchData, systemPrompt, callsPerQuestion } =
        await loadBenchmarkWithLogs(entry.benchmarkFile, entry.logFile);

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

  const visibleBenchmarks = useMemo(() => {
    if (!index) return [];
    return filterBenchmarks(index.benchmarks, models);
  }, [index, models]);

  if (!index) {
    return (
      <div style={{ fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", margin: "0 auto", padding: "60px 16px", textAlign: "center", color: "#999" }}>
        Loading benchmarks...
      </div>
    );
  }

  if (view === "loading") {
    return (
      <div style={{ fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", margin: "0 auto", padding: "60px 16px", textAlign: "center", color: "#999" }}>
        Loading benchmark data...
      </div>
    );
  }

  if (view === "dashboard" && dashboardData) {
    return <BenchmarkDashboard data={dashboardData} onClear={handleBack} answersData={answersData} />;
  }

  return (
    <>
      <BenchmarkPicker
        benchmarks={visibleBenchmarks}
        onSelect={loadBenchmark}
        showTitle={showTitle}
      />
      {error && (
        <div style={{ margin: "0 auto", padding: "0 16px" }}>
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
