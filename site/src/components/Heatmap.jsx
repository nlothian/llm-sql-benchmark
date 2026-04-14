import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { filterBenchmarks } from "./filterBenchmarks.js";
import { fetchGz } from "./fetchGz.js";
import { DIFF_COLORS, getPrefix, shortModel, compactModelName, loadBenchmarkWithLogs } from "./shared.jsx";
import AnswerDetail from "./AnswerDetail.jsx";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const DIFF_ORDER = ["trivial", "easy", "medium", "hard"];

function formatTokens(value) {
  return typeof value === "number" ? value.toLocaleString() : null;
}

function computeTokensPerSecond(tokens, durationMs) {
  if (typeof tokens !== "number" || typeof durationMs !== "number" || durationMs <= 0) return null;
  return tokens / (durationMs / 1000);
}

const STATUS_COLORS = {
  pass: "#5cb85c",
  fail: "#e06060",
  error: "#f0a030",
};

const runRowLinkStyle = {
  background: "none", border: "none", color: "#185fa5",
  fontSize: 10, cursor: "pointer", textDecoration: "underline", padding: 0,
};

function compareBenchmarkRows(a, b, sortKey, sortDir) {
  const dir = sortDir === "desc" ? -1 : 1;
  let cmp = 0;
  if (sortKey === "score") {
    cmp = (a.passed - b.passed) * dir;
    if (cmp !== 0) return cmp;
    cmp = (a.totalCost || 0) - (b.totalCost || 0);
    if (cmp !== 0) return cmp;
    return (a.totalDurationMs || 0) - (b.totalDurationMs || 0);
  } else if (sortKey === "cost") {
    cmp = ((a.totalCost || 0) - (b.totalCost || 0)) * dir;
    if (cmp !== 0) return cmp;
    cmp = b.passed - a.passed;
    if (cmp !== 0) return cmp;
    return (a.totalDurationMs || 0) - (b.totalDurationMs || 0);
  } else {
    cmp = ((a.totalDurationMs || 0) - (b.totalDurationMs || 0)) * dir;
    if (cmp !== 0) return cmp;
    cmp = b.passed - a.passed;
    if (cmp !== 0) return cmp;
    return (a.totalCost || 0) - (b.totalCost || 0);
  }
}

export default function Heatmap({
  models,
  showTitle = true,
  runRow = null,
  showAllModels = false,
  onToggleQuestion,
  onSelectAll,
  onSelectNone,
  onSelectDifficulty,
  highlightId = null,
}) {
  const interactive = !!runRow;
  const [allBenchmarks, setAllBenchmarks] = useState(null);
  const [error, setError] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [modelPopover, setModelPopover] = useState(null);
  const [prefixFilter, setPrefixFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [overlay, setOverlay] = useState(null);
  const [answersData, setAnswersData] = useState(null);
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState("desc");
  const [capturing, setCapturing] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [shareToast, setShareToast] = useState(null);
  const captureRef = useRef(null);
  const shareMenuRef = useRef(null);
  const detailCacheRef = useRef({});
  const rowRefs = useRef({});
  const modelPopoverRef = useRef(null);

  useEffect(() => {
    fetchGz("/data/index.json")
      .then(r => r.json())
      .then(data => setAllBenchmarks(data.benchmarks))
      .catch(() => setError("Failed to load benchmark data."));
  }, []);

  useEffect(() => {
    fetchGz("/data/answers.json")
      .then(r => r.json())
      .then(d => setAnswersData(d))
      .catch(() => {});
  }, []);

  const benchmarks = useMemo(() => {
    if (!allBenchmarks) return null;
    return filterBenchmarks(allBenchmarks, models);
  }, [allBenchmarks, models]);

  // Derive question order (grouped by difficulty) and model rows
  const { questions, modelRows, passCounts } = useMemo(() => {
    if (!benchmarks || benchmarks.length === 0) return { questions: [], modelRows: [], passCounts: {} };

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

    // Build status lookup per model
    const modelRows = benchmarks.map(b => {
      const statusMap = {};
      b.results.forEach(r => {
        const inputTokens = r.inputTokens;
        const outputTokens = r.outputTokens;
        const tokens =
          (typeof inputTokens === "number" || typeof outputTokens === "number")
            ? (inputTokens || 0) + (outputTokens || 0)
            : null;

        statusMap[r.id] = {
          status: r.status,
          cost: r.cost,
          durationMs: r.durationMs,
          attempts: r.attempts,
          inputTokens,
          outputTokens,
          tokens,
          tokensPerSecond: computeTokensPerSecond(tokens, r.durationMs),
          inputTokensPerSecond: computeTokensPerSecond(inputTokens, r.durationMs),
          outputTokensPerSecond: computeTokensPerSecond(outputTokens, r.durationMs),
        };
      });
      const inputTokenTotal = typeof b.totalInputTokens === "number"
        ? b.totalInputTokens
        : b.results.reduce((sum, r) => sum + (r.inputTokens || 0), 0);
      const outputTokenTotal = typeof b.totalOutputTokens === "number"
        ? b.totalOutputTokens
        : b.results.reduce((sum, r) => sum + (r.outputTokens || 0), 0);
      const totalTokens = inputTokenTotal + outputTokenTotal;
      const totalDurationMs = b.results.reduce((sum, r) => sum + (r.durationMs || 0), 0);
      const totalInputTokens = inputTokenTotal;
      const totalOutputTokens = outputTokenTotal;
      return {
        id: b.id,
        model: b.model,
        modelVariant: b.modelVariant,
        endpoint: b.endpoint,
        passed: b.passed,
        total: b.total,
        totalCost: b.totalCost,
        totalTokens,
        totalInputTokens,
        totalOutputTokens,
        tokensPerSecond: computeTokensPerSecond(totalTokens, totalDurationMs),
        inputTokensPerSecond: computeTokensPerSecond(totalInputTokens, totalDurationMs),
        outputTokensPerSecond: computeTokensPerSecond(totalOutputTokens, totalDurationMs),
        totalDurationMs,
        statusMap,
      };
    });

    // Per-question pass counts (rates derived inline)
    const counts = {};
    grouped.forEach(q => {
      const passed = benchmarks.filter(b =>
        b.results.find(r => r.id === q.id)?.status === "pass"
      ).length;
      counts[q.id] = { passed, total: benchmarks.length };
    });

    return { questions: grouped, modelRows, passCounts: counts };
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

  const prefixes = useMemo(() => {
    const set = new Set(modelRows.map(m => getPrefix(m.model)));
    return ["", ...Array.from(set).filter(Boolean).sort()];
  }, [modelRows]);

  const handleSort = useCallback((key) => {
    if (sortKey === key) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir(key === "score" ? "desc" : "asc");
    }
  }, [sortKey]);

  const filteredModels = useMemo(() => {
    let filtered = modelRows;
    if (prefixFilter) {
      filtered = filtered.filter(m => getPrefix(m.model) === prefixFilter);
    }
    if (nameFilter) {
      const lc = nameFilter.toLowerCase();
      filtered = filtered.filter(m => m.model.toLowerCase().includes(lc) || shortModel(m.model).toLowerCase().includes(lc));
    }
    filtered = [...filtered].sort((a, b) => compareBenchmarkRows(a, b, sortKey, sortDir));
    return filtered;
  }, [modelRows, prefixFilter, nameFilter, sortKey, sortDir]);

  // Scroll the highlighted row into view once it has rendered.
  useEffect(() => {
    if (!highlightId || !filteredModels.some(m => m.id === highlightId)) return;
    const el = rowRefs.current[highlightId];
    if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [highlightId, filteredModels]);

  // Compute run row stats and find neighbor rows for interactive mode
  const { neighborAbove, neighborBelow, runRowStats } = useMemo(() => {
    if (!runRow || !filteredModels.length) return { neighborAbove: null, neighborBelow: null, runRowStats: null };

    let passed = 0, totalCost = 0, totalDurationMs = 0, totalInputTokens = 0, totalOutputTokens = 0;
    for (const [, r] of runRow.results) {
      if (r.status === "pass") passed++;
      totalCost += r.cost || 0;
      totalDurationMs += r.durationMs || 0;
      totalInputTokens += r.inputTokens || 0;
      totalOutputTokens += r.outputTokens || 0;
    }
    const totalTokens = totalInputTokens + totalOutputTokens;

    const stats = {
      passed, total: questions.length, totalCost, totalDurationMs,
      totalInputTokens, totalOutputTokens, totalTokens,
      inputTokensPerSecond: computeTokensPerSecond(totalInputTokens, totalDurationMs),
      outputTokensPerSecond: computeTokensPerSecond(totalOutputTokens, totalDurationMs),
      tokensPerSecond: computeTokensPerSecond(totalTokens, totalDurationMs),
    };

    // Find insertion point using the same sort comparator
    let idx = filteredModels.length;
    for (let i = 0; i < filteredModels.length; i++) {
      const cmp = compareBenchmarkRows(stats, filteredModels[i], sortKey, sortDir);
      if (cmp <= 0) { idx = i; break; }
    }

    return {
      neighborAbove: idx > 0 ? filteredModels[idx - 1] : null,
      neighborBelow: idx < filteredModels.length ? filteredModels[idx] : null,
      runRowStats: stats,
    };
  }, [runRow, filteredModels, questions, sortKey, sortDir]);

  const showTooltip = (e, data) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ ...data, x: rect.left + rect.width / 2, y: rect.top });
  };

  const handleCellClick = useCallback(async (benchmarkId, questionId) => {
    const entry = allBenchmarks.find(b => b.id === benchmarkId);
    if (!entry) return;

    const questionResult = entry.results.find(r => r.id === questionId);
    const baseOverlay = {
      benchmarkId,
      questionId,
      model: entry.model,
      modelVariant: entry.modelVariant,
      questionText: questionResult?.question || "",
      difficulty: questionResult?.difficulty,
      status: questionResult?.status,
    };

    const updateIfCurrent = (updates) => {
      setOverlay(prev => prev && prev.benchmarkId === benchmarkId && prev.questionId === questionId
        ? { ...prev, ...updates }
        : prev
      );
    };

    setTooltip(null);

    // Use cache directly without a loading flash
    if (detailCacheRef.current[benchmarkId]) {
      const cached = detailCacheRef.current[benchmarkId];
      const result = cached.results.find(r => r.id === questionId);
      const calls = cached.callsPerQuestion[questionId] || [];
      setOverlay({ ...baseOverlay, loading: false, result, calls, systemPrompt: cached.systemPrompt });
      return;
    }

    setOverlay({ ...baseOverlay, loading: true });

    try {
      const { benchData, systemPrompt, callsPerQuestion } =
        await loadBenchmarkWithLogs(entry.benchmarkFile, entry.logFile);

      detailCacheRef.current[benchmarkId] = {
        results: benchData.results,
        systemPrompt,
        callsPerQuestion,
      };

      const result = benchData.results.find(r => r.id === questionId);
      const calls = callsPerQuestion[questionId] || [];
      updateIfCurrent({ loading: false, result, calls, systemPrompt });
    } catch (err) {
      updateIfCurrent({ loading: false, fetchError: err.message });
    }
  }, [allBenchmarks]);

  const CELL_W = "var(--heatmap-cell-w)";
  const CELL_H = 20;
  const SCORE_W = 52;
  const COST_W = 58;
  const TIME_W = 52;
  const FONT = "'Geist', 'SF Pro Display', -apple-system, sans-serif";

  const tableRef = useRef(null);
  const [modelColWidth, setModelColWidth] = useState(null);

  const computeModelColWidth = useCallback(() => {
    const table = tableRef.current;
    if (!table || !questions.length) return;
    const container = table.parentElement;
    if (!container) return;
    const cellW = parseFloat(getComputedStyle(table).getPropertyValue('--heatmap-cell-w')) || 0;
    const numCols = questions.length + 4;
    const spacing = (numCols - 1) * 2; // border-spacing between cells
    const w = container.clientWidth - SCORE_W - COST_W - TIME_W - questions.length * cellW - spacing;
    setModelColWidth(Math.max(0, Math.floor(w)));
  }, [questions]);

  useIsomorphicLayoutEffect(() => {
    computeModelColWidth();
    window.addEventListener('resize', computeModelColWidth);
    return () => window.removeEventListener('resize', computeModelColWidth);
  }, [computeModelColWidth]);

  const overlayOpen = !!overlay;
  useEffect(() => {
    if (!overlayOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setOverlay(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [overlayOpen]);

  if (error) {
    return (
      <div style={{ fontFamily: FONT, margin: "0 auto", padding: "60px 16px", textAlign: "center", color: "#a32d2d" }}>
        {error}
      </div>
    );
  }

  const generateImageBlob = useCallback(async () => {
    if (!captureRef.current) return null;
    setCapturing(true);
    try {
      await new Promise(r => requestAnimationFrame(r));
      const blob = await toBlob(captureRef.current, {
        backgroundColor: "#ffffff",
        pixelRatio: 2,
        fontEmbedCSS: "",
      });
      return blob;
    } finally {
      setCapturing(false);
    }
  }, []);

  const showToast = useCallback((msg) => setShareToast(msg), []);

  useEffect(() => {
    if (!shareToast) return;
    const timer = setTimeout(() => setShareToast(null), 3000);
    return () => clearTimeout(timer);
  }, [shareToast]);

  // Close the sticky model popover on outside click or Escape.
  useEffect(() => {
    if (!modelPopover) return;
    const onDocClick = (e) => {
      if (modelPopoverRef.current && !modelPopoverRef.current.contains(e.target)) {
        setModelPopover(null);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setModelPopover(null);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [modelPopover]);

  const handleCopyImage = useCallback(async () => {
    setShareMenuOpen(false);
    const blob = await generateImageBlob();
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("Image copied to clipboard");
    } catch {
      showToast("Failed to copy image");
    }
  }, [generateImageBlob, showToast]);

  const handleDownloadImage = useCallback(async () => {
    setShareMenuOpen(false);
    const blob = await generateImageBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "heatmap.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [generateImageBlob]);

  const handleShareToPlatform = useCallback(async (platform) => {
    setShareMenuOpen(false);
    const blob = await generateImageBlob();
    if (!blob) return;
    const siteUrl = "https://sql-benchmark.nicklothian.com/";
    const tags = { x: "@nlothian", linkedin: "Nick Lothian", bluesky: "@nlothian.bsky.social" };
    let text;
    if (runRow && runRowStats) {
      text = `${runRow.model} scored ${runRowStats.passed}/${runRowStats.total} on ${siteUrl} by ${tags[platform]}\n\n[Paste to share the image]`;
    } else {
      text = `Agentic LLM SQL Benchmark\n${siteUrl} by ${tags[platform]}\n\n[Paste to share the image]`;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch { /* proceed anyway */ }
    const urls = {
      x: `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`,
      linkedin: `https://www.linkedin.com/feed/?shareActive=true`,
      bluesky: `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`,
    };
    window.open(urls[platform], "_blank", "noopener");
    showToast("Image copied — paste it into your post");
  }, [generateImageBlob, showToast, runRow, runRowStats]);

  // Close share menu on outside click
  useEffect(() => {
    if (!shareMenuOpen) return;
    const handler = (e) => {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target)) {
        setShareMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [shareMenuOpen]);

  if (!benchmarks) {
    return (
      <div style={{ fontFamily: FONT, margin: "0 auto", padding: "60px 16px", textAlign: "center", color: "#999" }}>
        Loading heatmap data...
      </div>
    );
  }

  return (
    <div className="heatmap-panel" style={{ fontFamily: FONT, margin: "0 auto", padding: "24px 16px", color: "#1a1a1a", position: "relative" }}>
      {!capturing && (
        <div ref={shareMenuRef} style={{ position: "absolute", top: showTitle !== false ? 24 : 4, right: 16, zIndex: 50 }}>
          <button
            onClick={() => setShareMenuOpen(v => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: "none",
              border: "1px solid #ddd",
              borderRadius: 4,
              padding: "3px 8px",
              fontSize: 11,
              fontFamily: "inherit",
              color: "#666",
              cursor: "pointer",
            }}
            title="Share heatmap as image"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0, margin: 0 }}>
              <path d="M8 1v10M4 5l4-4 4 4M2 11v2a2 2 0 002 2h8a2 2 0 002-2v-2" />
            </svg>
            Share
          </button>
          {shareMenuOpen && (
            <div style={{
              position: "absolute", top: "100%", right: 0, marginTop: 4,
              background: "#fff", border: "1px solid #e0e0e0", borderRadius: 8,
              boxShadow: "0 4px 16px rgba(0,0,0,0.12)", padding: "4px 0",
              minWidth: 170, zIndex: 51, fontSize: 12,
            }}>
              {[
                { key: "x", label: "Share to X", icon: "𝕏" },
                { key: "linkedin", label: "Share to LinkedIn", icon: "in" },
                { key: "bluesky", label: "Share to Bluesky", icon: "🦋" },
              ].map(p => (
                <button key={p.key} onClick={() => handleShareToPlatform(p.key)} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", padding: "7px 14px", background: "none",
                  border: "none", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
                  color: "#333", textAlign: "left",
                }}>
                  <span style={{ width: 18, textAlign: "center", fontSize: 13, flexShrink: 0 }}>{p.icon}</span>
                  {p.label}
                </button>
              ))}
              <div style={{ borderTop: "1px solid #eee", margin: "4px 0" }} />
              <button onClick={handleCopyImage} style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "7px 14px", background: "none",
                border: "none", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
                color: "#333", textAlign: "left",
              }}>
                <span style={{ width: 18, textAlign: "center", fontSize: 13, flexShrink: 0, display: "inline-flex", justifyContent: "center" }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: 0 }}>
                    <rect x="5.5" y="5.5" width="8" height="9" rx="1.5" />
                    <path d="M10.5 5.5V3a1.5 1.5 0 00-1.5-1.5H4A1.5 1.5 0 002.5 3v7A1.5 1.5 0 004 11.5h1.5" />
                  </svg>
                </span>
                Copy Image
              </button>
              <button onClick={handleDownloadImage} style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "7px 14px", background: "none",
                border: "none", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
                color: "#333", textAlign: "left",
              }}>
                <span style={{ width: 18, textAlign: "center", fontSize: 13, flexShrink: 0, display: "inline-flex", justifyContent: "center" }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: 0 }}>
                    <path d="M8 1v10M4 7l4 4 4-4M2 13h12" />
                  </svg>
                </span>
                Download Image
              </button>
            </div>
          )}
        </div>
      )}

      {shareToast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "#333", color: "#fff", padding: "8px 16px", borderRadius: 8,
          fontSize: 13, zIndex: 10000, boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          pointerEvents: "none",
        }}>
          {shareToast}
        </div>
      )}

      <div ref={captureRef}>
      {showTitle !== false && (
        <>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px", letterSpacing: -0.3 }}>
            {typeof showTitle === "string" ? showTitle : "Model Heatmap"}
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
        </>
      )}

      <div style={{
        width: "100%",
        overflowX: capturing ? "visible" : "auto",
        position: "relative",
      }}>
        <table ref={tableRef} style={{ borderCollapse: "separate", borderSpacing: 2, whiteSpace: "nowrap", width: "100%", tableLayout: "fixed" }}>
          <colgroup>
            <col style={modelColWidth ? { width: modelColWidth } : undefined} />
            <col style={{ width: SCORE_W }} />
            <col style={{ width: COST_W }} />
            <col style={{ width: TIME_W }} />
            {questions.map(q => (
              <col key={q.id} style={{ width: CELL_W }} />
            ))}
          </colgroup>
          <thead>
            {/* Difficulty group header */}
            <tr>
              <th style={{ verticalAlign: "bottom", paddingBottom: 2 }}>
                {((showTitle !== false && !interactive) || (interactive && showAllModels)) && (
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
                )}
              </th>
              {[
                { key: "score", label: "Score", width: SCORE_W },
                { key: "cost", label: "Cost", width: COST_W },
                { key: "time", label: "Time", width: TIME_W },
              ].map(col => {
                const active = sortKey === col.key;
                const arrow = active ? (sortDir === "desc" ? " \u25BC" : " \u25B2") : "";
                return (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{
                      width: col.width,
                      fontSize: 11,
                      fontWeight: 700,
                      textAlign: "center",
                      cursor: "pointer",
                      userSelect: "none",
                      color: active ? "#1a1a1a" : "#888",
                      padding: "4px 0",
                    }}
                  >
                    {col.label}{arrow}
                  </th>
                );
              })}
              {diffGroups.map((g, gi) => {
                const dc = DIFF_COLORS[g.diff];
                const idsForDiff = questions.filter(q => q.difficulty === g.diff).map(q => q.id);
                const diffSelected = interactive && idsForDiff.length > 0 && idsForDiff.every(id => runRow.selectedIds.has(id));
                const isLast = gi === diffGroups.length - 1;
                const allSelected = interactive && isLast && questions.length > 0 && questions.every(q => runRow.selectedIds.has(q.id));
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
                    {interactive && (
                      <input
                        type="checkbox"
                        checked={diffSelected}
                        onChange={(e) => onSelectDifficulty?.(g.diff, e.target.checked)}
                        style={{ margin: "0 3px 0 0", verticalAlign: "middle" }}
                      />
                    )}
                    {g.diff}
                    {interactive && isLast && (
                      <label style={{ marginLeft: 12, fontStyle: "normal", color: "#185fa5", cursor: "pointer", userSelect: "none" }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(e) => e.target.checked ? onSelectAll?.() : onSelectNone?.()}
                          style={{ margin: "0 3px 0 0", verticalAlign: "middle" }}
                        />
                        all
                      </label>
                    )}
                  </th>
                );
              })}
            </tr>
            {/* Question ID header */}
            <tr>
              <th />
              <th />
              <th />
              <th />
              {questions.map(q => (
                <th
                  key={q.id}
                  onMouseEnter={(e) => showTooltip(e, {
                    type: "question",
                    questionId: q.id,
                    difficulty: q.difficulty,
                    passed: passCounts[q.id].passed,
                    total: passCounts[q.id].total,
                    questionText: answersData?.questions?.find(aq => aq.id === q.id)?.question || null,
                  })}
                  onMouseLeave={() => setTooltip(null)}
                  style={{
                    fontSize: 10, fontWeight: 500, color: "#999", textAlign: "center",
                    width: CELL_W, padding: "2px 0", overflow: "hidden",
                    cursor: "default",
                  }}
                >
                  Q{q.id}
                </th>
              ))}
            </tr>
            {/* Per-question correct/total row */}
            <tr>
              <th />
              <th />
              <th />
              <th />
              {questions.map(q => (
                <th key={q.id} style={{
                  position: "relative",
                  width: CELL_W, padding: 0, overflow: "hidden",
                }}>
                  <span style={{
                    position: "absolute",
                    left: "50%", top: 1,
                    transform: "translateX(-50%)",
                    fontSize: 9, fontWeight: 500, color: "#bbb",
                    whiteSpace: "nowrap",
                  }}>
                    {passCounts[q.id].passed}/{passCounts[q.id].total}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Compute insertion index for the run row
              let insertIdx = filteredModels.length;
              if (interactive && runRowStats) {
                for (let i = 0; i < filteredModels.length; i++) {
                  if (compareBenchmarkRows(runRowStats, filteredModels[i], sortKey, sortDir) <= 0) {
                    insertIdx = i;
                    break;
                  }
                }
              }

              const renderModelRow = (m, rowIndex, extraStyle) => {
                const isHighlighted = highlightId && m.id === highlightId;
                return (
                <tr
                  key={m.id}
                  ref={el => { if (el) rowRefs.current[m.id] = el; else delete rowRefs.current[m.id]; }}
                  style={{
                    background: isHighlighted
                      ? "rgba(245,158,11,0.12)"
                      : (rowIndex % 2 === 0 ? "#ffffff" : "#f6f5f2"),
                    ...(isHighlighted ? { outline: "2px solid #f59e0b", outlineOffset: -1 } : {}),
                    ...extraStyle,
                  }}
                >
                  <td
                    onMouseEnter={(e) => showTooltip(e, {
                      type: "model-name",
                      model: m.model,
                      modelVariant: m.modelVariant,
                      totalInputTokens: m.totalInputTokens,
                      totalOutputTokens: m.totalOutputTokens,
                      totalTokens: m.totalTokens,
                      inputTokensPerSecond: m.inputTokensPerSecond,
                      outputTokensPerSecond: m.outputTokensPerSecond,
                      tokensPerSecond: m.tokensPerSecond,
                    })}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setTooltip(null);
                      setModelPopover({
                        id: m.id,
                        model: m.model,
                        modelVariant: m.modelVariant,
                        x: rect.left + rect.width / 2,
                        y: rect.bottom,
                      });
                    }}
                    style={{
                      fontSize: 12, fontWeight: 600, color: "#444", textAlign: "left",
                      paddingLeft: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      cursor: "pointer",
                    }}
                  >
                    {m.endpoint?.includes("openrouter.ai") && (
                      <img src="/openrouter-logo.ico" alt="OpenRouter" style={{ display: "inline", width: 12, height: 12, margin: 0, marginRight: 4, verticalAlign: "-2px" }} />
                    )}
                    {m.endpoint?.includes("192.168.20.18") && (
                      <img src="/llamacpp-logo.jpg" alt="llama.cpp" style={{ display: "inline", width: 12, height: 12, borderRadius: 2, margin: 0, marginRight: 4, verticalAlign: "-2px" }} />
                    )}
                    {compactModelName(shortModel(m.model), m.modelVariant)}
                  </td>
                  <td
                    onMouseEnter={(e) => showTooltip(e, {
                      type: "score",
                      model: m.model,
                      modelVariant: m.modelVariant,
                      passed: m.passed,
                      total: m.total,
                    })}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      fontSize: 12, fontWeight: 600, color: "#666", textAlign: "center",
                      padding: "0 4px", cursor: "default",
                    }}
                  >
                    {m.passed}/{m.total}
                  </td>
                  <td style={{
                    fontSize: 11, color: "#888", textAlign: "center",
                    padding: "0 4px", cursor: "default",
                  }}>
                    {m.totalCost != null ? `$${m.totalCost.toFixed(2)}` : "—"}
                  </td>
                  <td style={{
                    fontSize: 11, color: "#888", textAlign: "center",
                    padding: "0 4px", cursor: "default",
                  }}>
                    {m.totalDurationMs != null ? `${(m.totalDurationMs / 1000).toFixed(0)}s` : "—"}
                  </td>
                  {questions.map(q => {
                    const cell = m.statusMap[q.id] || {};
                    const status = cell.status || "error";
                    const bg = STATUS_COLORS[status] || STATUS_COLORS.error;
                    return (
                      <td
                        key={q.id}
                        onClick={() => handleCellClick(m.id, q.id)}
                        onMouseEnter={(e) => showTooltip(e, {
                          model: m.model,
                          modelVariant: m.modelVariant,
                          questionId: q.id,
                          difficulty: q.difficulty,
                          status,
                          cost: cell.cost,
                          durationMs: cell.durationMs,
                          attempts: cell.attempts,
                          inputTokens: cell.inputTokens,
                          outputTokens: cell.outputTokens,
                          tokens: cell.tokens,
                          tokensPerSecond: cell.tokensPerSecond,
                          inputTokensPerSecond: cell.inputTokensPerSecond,
                          outputTokensPerSecond: cell.outputTokensPerSecond,
                        })}
                        onMouseLeave={() => setTooltip(null)}
                        style={{
                          width: CELL_W, height: CELL_H,
                          background: bg,
                          borderRadius: 3,
                          cursor: "pointer",
                          padding: 0,
                          overflow: "hidden",
                        }}
                      />
                    );
                  })}
                </tr>
                );
              };

              const separatorRow = (key) => (
                <tr key={key} style={{ height: 8 }}>
                  <td colSpan={4 + questions.length} />
                </tr>
              );

              const runRowElement = interactive && runRow && (
                <tr key="__run-row__" style={{
                  outline: "2px solid #185fa5",
                  outlineOffset: -1,
                  background: "rgba(24, 95, 165, 0.06)",
                }}>
                  <td
                    onMouseEnter={(e) => showTooltip(e, {
                      type: "model-name",
                      model: runRow.model || "Your model",
                      modelVariant: null,
                      totalInputTokens: runRowStats?.totalInputTokens,
                      totalOutputTokens: runRowStats?.totalOutputTokens,
                      totalTokens: runRowStats?.totalTokens,
                      inputTokensPerSecond: runRowStats?.inputTokensPerSecond,
                      outputTokensPerSecond: runRowStats?.outputTokensPerSecond,
                      tokensPerSecond: runRowStats?.tokensPerSecond,
                    })}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                    fontSize: 12, fontWeight: 600, color: "#185fa5", textAlign: "left",
                    paddingLeft: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    cursor: "default",
                  }}>
                    <span>{runRow.model || "Your model"}</span>
                  </td>
                  <td style={{
                    fontSize: 12, fontWeight: 600, color: "#185fa5", textAlign: "center",
                    padding: "0 4px", cursor: "default",
                  }}>
                    {runRowStats ? `${runRowStats.passed}/${runRowStats.total}` : `0/${questions.length}`}
                  </td>
                  <td style={{
                    fontSize: 11, color: "#185fa5", textAlign: "center",
                    padding: "0 4px", cursor: "default",
                  }}>
                    {runRowStats && runRowStats.totalCost > 0 ? `$${runRowStats.totalCost.toFixed(2)}` : "—"}
                  </td>
                  <td style={{
                    fontSize: 11, color: "#185fa5", textAlign: "center",
                    padding: "0 4px", cursor: "default",
                  }}>
                    {runRowStats && runRowStats.totalDurationMs > 0
                      ? `${(runRowStats.totalDurationMs / 1000).toFixed(0)}s`
                      : "—"}
                  </td>
                  {questions.map(q => {
                    const result = runRow.results.get(q.id);
                    const selected = runRow.selectedIds.has(q.id);
                    const isRunning = runRow.currentQuestionId === q.id;

                    let bg, content = null;
                    if (result) {
                      bg = STATUS_COLORS[result.status] || STATUS_COLORS.error;
                    } else if (isRunning) {
                      bg = "transparent";
                      content = <span className="heatmap-running-spinner" />;
                    } else if (selected) {
                      bg = "#d0cec8";
                      content = <span style={{ fontSize: 9, color: "#888", lineHeight: `${CELL_H}px` }}>&#10003;</span>;
                    } else {
                      bg = "#eeedea";
                    }

                    return (
                      <td
                        key={q.id}
                        onClick={() => {
                          if (result) {
                            const questionData = answersData?.questions?.find(aq => aq.id === q.id);
                            setTooltip(null);
                            setOverlay({
                              benchmarkId: null,
                              questionId: q.id,
                              model: runRow.model,
                              questionText: questionData?.question || "",
                              difficulty: q.difficulty,
                              status: result.status,
                              loading: false,
                              result: { sql: result.sql || "", check: result.check, error: result.error },
                              calls: result.calls || [],
                              systemPrompt: result.systemPrompt || null,
                            });
                          } else {
                            onToggleQuestion?.(q.id);
                          }
                        }}
                        onMouseEnter={result ? (e) => showTooltip(e, {
                          model: runRow.model,
                          questionId: q.id,
                          difficulty: q.difficulty,
                          status: result.status,
                          cost: result.cost,
                          durationMs: result.durationMs,
                          attempts: result.attempts,
                          inputTokens: result.inputTokens,
                          outputTokens: result.outputTokens,
                          tokens:
                            typeof result.inputTokens === "number" || typeof result.outputTokens === "number"
                              ? (result.inputTokens || 0) + (result.outputTokens || 0)
                              : null,
                          tokensPerSecond:
                            typeof result.inputTokens === "number" || typeof result.outputTokens === "number"
                              ? computeTokensPerSecond(
                                  (result.inputTokens || 0) + (result.outputTokens || 0),
                                  result.durationMs,
                                )
                              : null,
                          inputTokensPerSecond: computeTokensPerSecond(result.inputTokens, result.durationMs),
                          outputTokensPerSecond: computeTokensPerSecond(result.outputTokens, result.durationMs),
                        }) : undefined}
                        onMouseLeave={result ? () => setTooltip(null) : undefined}
                        style={{
                          width: CELL_W, height: CELL_H,
                          background: bg,
                          borderRadius: 3,
                          cursor: "pointer",
                          textAlign: "center",
                          lineHeight: `${CELL_H}px`,
                          padding: 0,
                          overflow: "hidden",
                        }}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              );

              const rows = [];
              if (interactive && !showAllModels) {
                // Compact view: only show 3 rows
                if (neighborAbove) rows.push(renderModelRow(neighborAbove, insertIdx - 1, { opacity: 0.85 }));
                rows.push(runRowElement);
                if (neighborBelow) rows.push(renderModelRow(neighborBelow, insertIdx, { opacity: 0.85 }));
              } else if (interactive && showAllModels) {
                // Expanded view: all models + run row at sorted position
                filteredModels.forEach((m, idx) => {
                  const adjustedIdx = idx >= insertIdx ? idx + 1 : idx;
                  if (idx === insertIdx) rows.push(runRowElement);
                  rows.push(renderModelRow(m, adjustedIdx));
                });
                if (insertIdx >= filteredModels.length) rows.push(runRowElement);
              } else {
                filteredModels.forEach((m, idx) => rows.push(renderModelRow(m, idx)));
              }
              return rows;
            })()}
            {/* Pass rate row */}
            <tr>
              <td style={{ fontSize: 11, color: "#999", textAlign: "right", paddingRight: 10, paddingTop: 6 }}>
                pass rate
              </td>
              <td />
              <td />
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
                    {Math.round((passCounts[q.id].passed / passCounts[q.id].total) * 100)}%
                  </span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      </div>

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
            {tooltip.type === "model-name" ? (
              <div style={{ fontWeight: 700, color: "#1a1a1a" }}>
                {tooltip.model}{tooltip.modelVariant ? ` (${tooltip.modelVariant})` : ''}
                <div style={{ color: "#666", marginTop: 6 }}>
                  Input
                </div>
                <div style={{ color: "#666", marginLeft: 14 }}>
                  {`Tokens: ${formatTokens(tooltip.totalInputTokens) != null ? formatTokens(tooltip.totalInputTokens) : "—"}`}
                </div>
                <div style={{ color: "#666", marginLeft: 14 }}>
                  {tooltip.inputTokensPerSecond != null
                    ? `${tooltip.inputTokensPerSecond.toFixed(2)} tokens/s`
                    : "Tokens/sec: —"}
                </div>
                <div style={{ color: "#666", marginTop: 4 }}>
                  Output
                </div>
                <div style={{ color: "#666", marginLeft: 14 }}>
                  {`Tokens: ${formatTokens(tooltip.totalOutputTokens) != null ? formatTokens(tooltip.totalOutputTokens) : "—"}`}
                </div>
                <div style={{ color: "#666", marginLeft: 14 }}>
                  {tooltip.outputTokensPerSecond != null
                    ? `${tooltip.outputTokensPerSecond.toFixed(2)} tokens/s`
                    : "Tokens/sec: —"}
                </div>
              </div>
            ) : tooltip.type === "question" ? (
              <>
                <div style={{ fontWeight: 700, color: "#1a1a1a", marginBottom: 2 }}>Q{tooltip.questionId} · {tooltip.difficulty}</div>
                <div style={{ color: "#666" }}>
                  {tooltip.passed}/{tooltip.total} passed ({Math.round((tooltip.passed / tooltip.total) * 100)}%)
                </div>
                {tooltip.questionText && (
                  <div style={{ color: "#444", marginTop: 4, maxWidth: 300, whiteSpace: "normal" }}>
                    {tooltip.questionText}
                  </div>
                )}
              </>
            ) : tooltip.type === "score" ? (
              <>
                <div style={{ fontWeight: 700, color: "#1a1a1a", marginBottom: 2 }}>{shortModel(tooltip.model)}{tooltip.modelVariant ? ` (${tooltip.modelVariant})` : ''}</div>
                <div style={{ color: "#666" }}>
                  {tooltip.passed}/{tooltip.total} passed ({Math.round((tooltip.passed / tooltip.total) * 100)}%)
                </div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, color: "#1a1a1a", marginBottom: 2 }}>{shortModel(tooltip.model)}{tooltip.modelVariant ? ` (${tooltip.modelVariant})` : ''}</div>
                <div style={{ color: "#666" }}>
                  Q{tooltip.questionId} · {tooltip.difficulty} ·{" "}
                  <span style={{ fontWeight: 600, color: STATUS_COLORS[tooltip.status] }}>
                    {tooltip.status}
                  </span>
                </div>
                <div style={{ color: "#666", marginTop: 2 }}>
                  {tooltip.durationMs != null && <span>{(tooltip.durationMs / 1000).toFixed(1)}s</span>}
                  {tooltip.cost != null && <span> · ${tooltip.cost.toFixed(4)}</span>}
                  {tooltip.attempts != null && tooltip.attempts > 1 && <span> · {tooltip.attempts} attempts</span>}
                </div>
                <div style={{ color: "#666", marginTop: 4 }}>Input</div>
                <div style={{ color: "#666", marginLeft: 14 }}>
                  {`Tokens: ${formatTokens(tooltip.inputTokens) != null ? formatTokens(tooltip.inputTokens) : "—"}`}
                </div>
                <div style={{ color: "#666", marginLeft: 14 }}>
                  {tooltip.inputTokensPerSecond != null
                    ? `${tooltip.inputTokensPerSecond.toFixed(2)} tokens/s`
                    : "Tokens/sec: —"}
                </div>
                <div style={{ color: "#666", marginTop: 4 }}>Output</div>
                <div style={{ color: "#666", marginLeft: 14 }}>
                  {`Tokens: ${formatTokens(tooltip.outputTokens) != null ? formatTokens(tooltip.outputTokens) : "—"}`}
                </div>
                <div style={{ color: "#666", marginLeft: 14 }}>
                  {tooltip.outputTokensPerSecond != null
                    ? `${tooltip.outputTokensPerSecond.toFixed(2)} tokens/s`
                    : "Tokens/sec: —"}
                </div>
                <div style={{ color: "#aaa", fontSize: 11, marginTop: 4, fontStyle: "italic" }}>click for details</div>
              </>
            )}
          </div>
        )}

        {/* Sticky model popover — opens on model-name click */}
        {modelPopover && (
          <div
            ref={modelPopoverRef}
            style={{
              position: "fixed",
              left: modelPopover.x,
              top: modelPopover.y + 6,
              transform: "translateX(-50%)",
              background: "#fff",
              border: "1px solid #e8e6e0",
              borderRadius: 8,
              padding: "8px 10px",
              boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
              zIndex: 101,
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "nowrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontWeight: 700, color: "#1a1a1a" }}>
                {modelPopover.model}{modelPopover.modelVariant ? ` (${modelPopover.modelVariant})` : ''}
              </span>
              <button
                onClick={async () => {
                  const raw = modelPopover.model + (modelPopover.modelVariant ? ` (${modelPopover.modelVariant})` : "");
                  try {
                    await navigator.clipboard.writeText(raw);
                    showToast("Model ID copied");
                  } catch {
                    showToast("Copy failed");
                  }
                }}
                title="Copy model ID"
                style={{
                  border: "1px solid #e0ddd5", background: "#fafafa",
                  borderRadius: 4, padding: 0, width: 28, height: 28,
                  cursor: "pointer", color: "#666",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="5" y="5" width="9" height="9" rx="1.5" />
                  <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
                </svg>
              </button>
              <button
                onClick={async () => {
                  const url = `${window.location.origin}${window.location.pathname}?highlight=${encodeURIComponent(modelPopover.id)}`;
                  try {
                    await navigator.clipboard.writeText(url);
                    showToast("Share link copied");
                  } catch {
                    showToast("Copy failed");
                  }
                }}
                title="Copy share link"
                style={{
                  border: "1px solid #e0ddd5", background: "#fafafa",
                  borderRadius: 4, padding: 0, width: 28, height: 28,
                  cursor: "pointer", color: "#666",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="4" cy="8" r="2" />
                  <circle cx="12" cy="4" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <path d="M5.7 7 10.3 4.8M5.7 9l4.6 2.2" />
                </svg>
              </button>
              <button
                onClick={() => setModelPopover(null)}
                title="Close"
                style={{
                  border: "none", background: "transparent",
                  padding: 0, width: 28, height: 28,
                  cursor: "pointer", color: "#999",
                  fontSize: 20, lineHeight: 1, marginLeft: 2,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}
              >
                ×
              </button>
            </div>
          </div>
        )}

        {overlay && (
          <div
            onClick={() => setOverlay(null)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              background: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 32,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#fff",
                borderRadius: 12,
                maxWidth: 800,
                width: "100%",
                maxHeight: "90vh",
                overflow: "auto",
                boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
                position: "relative",
              }}
            >
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "16px 20px", borderBottom: "1px solid #e8e6e0",
                position: "sticky", top: 0, background: "#fff", zIndex: 1,
                borderRadius: "12px 12px 0 0",
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>
                    {shortModel(overlay.model)}{overlay.modelVariant ? ` (${overlay.modelVariant})` : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                    Q{overlay.questionId} · {overlay.difficulty} ·{" "}
                    <span style={{ fontWeight: 600, color: STATUS_COLORS[overlay.status] }}>
                      {overlay.status}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setOverlay(null)}
                  style={{
                    background: "none", border: "none", fontSize: 20,
                    color: "#999", cursor: "pointer", padding: "4px 8px",
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>

              <div>
                {overlay.loading ? (
                  <div style={{ padding: "40px 20px", textAlign: "center", color: "#999", fontSize: 13 }}>
                    Loading detail data…
                  </div>
                ) : overlay.fetchError ? (
                  <div style={{ padding: "20px", color: "#a32d2d", fontSize: 13 }}>
                    {overlay.fetchError}
                  </div>
                ) : (
                  <AnswerDetail
                    question={overlay.questionText}
                    sql={overlay.result?.sql || ""}
                    referenceSql={answersData?.questions?.find(q => q.id === overlay.questionId)?.sql || null}
                    includedTables={answersData?.questions?.find(q => q.id === overlay.questionId)?.included_tables || null}
                    check={overlay.result?.check || null}
                    calls={overlay.calls || []}
                    error={overlay.result?.error || null}
                    systemPrompt={overlay.systemPrompt || null}
                  />
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
