import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { filterBenchmarks } from "./filterBenchmarks.js";
import { fetchGz } from "./fetchGz.js";
import { getPrefix, shortModel } from "./shared.jsx";

const CHART_W = 800;
const CHART_H = 500;
const MARGIN = { top: 30, right: 40, bottom: 60, left: 70 };
const PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
const PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;

function colorForWeights(weightsAvailable) {
  if (weightsAvailable === 'closed') return { fill: "rgba(61,79,95,0.55)", stroke: "#3D4F5F" };
  return { fill: "rgba(39,174,96,0.55)", stroke: "#27AE60" };
}

function niceRange(min, max, padding = 0.1) {
  const span = max - min || 1;
  return [min - span * padding, max + span * padding];
}

function niceTicks(min, max, count = 5) {
  const step = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step)));
  const nice = [1, 2, 2.5, 5, 10].find(n => n * mag >= step) * mag;
  const start = Math.ceil(min / nice) * nice;
  const ticks = [];
  for (let v = start; v <= max; v += nice) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return ticks;
}

function logTicks(min, max) {
  const ticks = [];
  const minPow = Math.floor(Math.log10(min));
  const maxPow = Math.ceil(Math.log10(max));
  for (let p = minPow; p <= maxPow; p++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, p);
      if (v >= min * 0.95 && v <= max * 1.05) ticks.push(v);
    }
  }
  return ticks;
}

export default function BubbleChart({ models, showTitle = true, highlightId = null }) {
  const [allBenchmarks, setAllBenchmarks] = useState(null);
  const [error, setError] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: CHART_W, h: CHART_H });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);
  const [prefixFilter, setPrefixFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const initialViewBox = useMemo(() => ({ x: 0, y: 0, w: CHART_W, h: CHART_H }), []);

  useEffect(() => {
    fetchGz("/data/index.json")
      .then(r => r.json())
      .then(data => setAllBenchmarks(data.benchmarks))
      .catch(() => setError("Failed to load benchmark data."));
  }, []);

  const benchmarks = useMemo(() => {
    if (!allBenchmarks) return null;
    return filterBenchmarks(allBenchmarks, models);
  }, [allBenchmarks, models]);

  const chartData = useMemo(() => {
    if (!benchmarks) return null;
    return benchmarks.map(b => ({
      id: b.id,
      model: b.model,
      modelVariant: b.modelVariant,
      passRate: b.total > 0 ? (b.passed / b.total) * 100 : 0,
      totalLatency: b.results.reduce((s, r) => s + r.durationMs, 0) / 1000,
      cost: b.totalCost ?? 0,
      passed: b.passed,
      total: b.total,
      throttleTimeSec: b.throttleTimeSec ?? null,
      weightsAvailable: b.weightsAvailable ?? 'open',
    }));
  }, [benchmarks]);

  const prefixes = useMemo(() => {
    if (!chartData) return [""];
    const set = new Set(chartData.map(d => getPrefix(d.model)));
    return ["", ...Array.from(set).filter(Boolean).sort()];
  }, [chartData]);

  const filteredChartData = useMemo(() => {
    if (!chartData) return null;
    let filtered = chartData;
    if (prefixFilter) {
      filtered = filtered.filter(d => getPrefix(d.model) === prefixFilter);
    }
    if (nameFilter) {
      const lc = nameFilter.toLowerCase();
      filtered = filtered.filter(d => shortModel(d.model).toLowerCase().includes(lc));
    }
    return filtered;
  }, [chartData, prefixFilter, nameFilter]);

  const scales = useMemo(() => {
    if (!chartData) return null;
    const latencies = chartData.map(d => d.totalLatency);
    const rates = chartData.map(d => d.passRate);
    const costs = chartData.map(d => d.cost);

    const rawMin = Math.min(...latencies);
    const rawMax = Math.max(...latencies);
    const xMin = rawMin * 0.85;
    const xMax = rawMax * 1.15;
    const logXMin = Math.log10(xMin);
    const logXMax = Math.log10(xMax);
    const [yMin, yMax] = niceRange(Math.min(...rates), Math.max(...rates));
    const maxCost = Math.max(...costs);

    return {
      xMin, xMax, yMin, yMax, maxCost,
      xTicks: logTicks(xMin, xMax),
      yTicks: niceTicks(yMin, yMax, 5),
      toX: v => MARGIN.left + ((Math.log10(v) - logXMin) / (logXMax - logXMin)) * PLOT_W,
      toY: v => MARGIN.top + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H,
      toR: v => maxCost > 0 ? 6 + Math.sqrt(v / maxCost) * 24 : 6,
    };
  }, [chartData]);

  const labelLayout = useMemo(() => {
    if (!filteredChartData || !scales) return {};
    const zoomScale = viewBox.w / CHART_W;
    const fontSize = 9 * zoomScale;
    const charWidth = fontSize * 0.55;
    const labelHeight = fontSize * 1.2;

    const labels = filteredChartData.map(d => {
      const cx = scales.toX(d.totalLatency);
      const cy = scales.toY(d.passRate);
      const r = scales.toR(d.cost);
      const base = d.model.split("/").pop().split(":")[0].slice(0, 20);
      const variant = d.modelVariant ? ` (${d.modelVariant})` : '';
      const throttle = d.throttleTimeSec != null ? ' (throttled)' : '';
      const text = `${base}${variant}${throttle}`;
      const textWidth = text.length * charWidth;
      const y = cy - r - 4 * zoomScale;

      return {
        id: d.id,
        text,
        x: cx,
        y,
        left: cx - textWidth / 2,
        right: cx + textWidth / 2,
        top: y - labelHeight,
        bottom: y,
        visible: true,
      };
    });

    // Highlighted label wins its slot: put it first so it's never hidden
    // by the overlap-suppression pass, and so overlapping neighbors lose instead.
    labels.sort((a, b) => {
      if (highlightId) {
        if (a.id === highlightId) return -1;
        if (b.id === highlightId) return 1;
      }
      return a.left - b.left;
    });

    for (let i = 0; i < labels.length; i++) {
      if (!labels[i].visible) continue;
      for (let j = i + 1; j < labels.length; j++) {
        if (!labels[j].visible) continue;
        if (
          labels[i].right > labels[j].left &&
          labels[i].left < labels[j].right &&
          labels[i].bottom > labels[j].top &&
          labels[i].top < labels[j].bottom
        ) {
          labels[j].visible = false;
        }
      }
    }

    const map = {};
    labels.forEach(l => { map[l.id] = l; });
    return map;
  }, [filteredChartData, scales, viewBox.w, highlightId]);

  // Wheel zoom (non-passive to allow preventDefault)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top) / rect.height;
      const factor = e.deltaY < 0 ? 0.9 : 1.1;

      setViewBox(prev => {
        const newW = Math.max(100, Math.min(CHART_W, prev.w * factor));
        const newH = Math.max(62.5, Math.min(CHART_H, prev.h * factor));
        const newX = prev.x + (prev.w - newW) * mx;
        const newY = prev.y + (prev.h - newH) * my;
        return { x: newX, y: newY, w: newW, h: newH };
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY, vb: { ...viewBox } });
  }, [viewBox]);

  const onMouseMove = useCallback((e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    if (!isPanning || !panStart) return;
    const rect2 = containerRef.current?.getBoundingClientRect();
    if (!rect2) return;
    const dx = (e.clientX - panStart.x) / rect2.width * panStart.vb.w;
    const dy = (e.clientY - panStart.y) / rect2.height * panStart.vb.h;
    setViewBox({ x: panStart.vb.x - dx, y: panStart.vb.y - dy, w: panStart.vb.w, h: panStart.vb.h });
  }, [isPanning, panStart]);

  const onMouseUp = useCallback(() => {
    setIsPanning(false);
    setPanStart(null);
  }, []);

  const zoomBy = useCallback((factor) => {
    setViewBox(prev => {
      const newW = Math.max(100, Math.min(CHART_W, prev.w * factor));
      const newH = Math.max(62.5, Math.min(CHART_H, prev.h * factor));
      const newX = prev.x + (prev.w - newW) * 0.5;
      const newY = prev.y + (prev.h - newH) * 0.5;
      return { x: newX, y: newY, w: newW, h: newH };
    });
  }, []);

  const isZoomed = viewBox.w < CHART_W - 1 || viewBox.h < CHART_H - 1
    || Math.abs(viewBox.x) > 1 || Math.abs(viewBox.y) > 1;

  if (error) {
    return (
      <div style={{ fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", margin: "0 auto", padding: "60px 16px", textAlign: "center", color: "#a32d2d" }}>
        {error}
      </div>
    );
  }

  if (!chartData || !scales) {
    return (
      <div style={{ fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", margin: "0 auto", padding: "60px 16px", textAlign: "center", color: "#999" }}>
        Loading chart data...
      </div>
    );
  }

  const hovered = hoveredId ? filteredChartData.find(d => d.id === hoveredId) : null;

  return (
    <div style={{ fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif", margin: "0 auto", padding: "24px 16px" }}>
      {showTitle !== false && (
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px", letterSpacing: -0.3, color: "#1a1a1a" }}>
            {typeof showTitle === "string" ? showTitle : "Total Time vs Pass Rate vs Cost"}
          </h2>
          <div style={{ fontSize: 13, color: "#999" }}>
            Bubble size represents total cost. Scroll to zoom, drag to pan.
          </div>
          <div style={{ display: "flex", marginTop: 10 }}>
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
                width: 160, boxSizing: "border-box",
                fontSize: 11, padding: "3px 6px",
                border: "1px solid #ddd", borderRadius: "0 4px 4px 0",
                outline: "none", fontFamily: "inherit",
                color: "#444", background: "#fafafa",
              }}
            />
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { onMouseUp(); setHoveredId(null); }}
        style={{
          position: "relative",
          cursor: isPanning ? "grabbing" : "grab",
          userSelect: "none",
          borderRadius: 10,
          border: "1px solid #e8e6e0",
          background: "#fff",
          overflow: "hidden",
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          width="100%"
          style={{ display: "block" }}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Grid lines */}
          {scales.xTicks.map(v => (
            <line key={`gx-${v}`}
              x1={scales.toX(v)} y1={MARGIN.top}
              x2={scales.toX(v)} y2={MARGIN.top + PLOT_H}
              stroke="#e8e6e0" strokeDasharray="4,4" opacity={0.6}
            />
          ))}
          {scales.yTicks.map(v => (
            <line key={`gy-${v}`}
              x1={MARGIN.left} y1={scales.toY(v)}
              x2={MARGIN.left + PLOT_W} y2={scales.toY(v)}
              stroke="#e8e6e0" strokeDasharray="4,4" opacity={0.6}
            />
          ))}

          {/* Axes */}
          <line x1={MARGIN.left} y1={MARGIN.top + PLOT_H} x2={MARGIN.left + PLOT_W} y2={MARGIN.top + PLOT_H} stroke="#ccc" strokeWidth={1} />
          <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={MARGIN.top + PLOT_H} stroke="#ccc" strokeWidth={1} />

          {/* X tick labels */}
          {scales.xTicks.map(v => (
            <text key={`xt-${v}`} x={scales.toX(v)} y={MARGIN.top + PLOT_H + 18}
              textAnchor="middle" fontSize={10} fill="#999" fontFamily="monospace">
              {Math.round(v)}s
            </text>
          ))}

          {/* Y tick labels */}
          {scales.yTicks.map(v => (
            <text key={`yt-${v}`} x={MARGIN.left - 10} y={scales.toY(v) + 3.5}
              textAnchor="end" fontSize={10} fill="#999" fontFamily="monospace">
              {Math.round(v)}%
            </text>
          ))}

          {/* Axis labels */}
          <text x={MARGIN.left + PLOT_W / 2} y={CHART_H - 8}
            textAnchor="middle" fontSize={12} fill="#888" fontWeight={600}>
            Total Time (seconds, log scale)
          </text>
          <text
            transform={`rotate(-90, 16, ${MARGIN.top + PLOT_H / 2})`}
            x={16} y={MARGIN.top + PLOT_H / 2}
            textAnchor="middle" fontSize={12} fill="#888" fontWeight={600}>
            Pass Rate (%)
          </text>

          {/* Bubbles — highlighted bubble sorts last so it renders on top */}
          {[...filteredChartData].sort((a, b) => {
            if (highlightId) {
              if (a.id === highlightId) return 1;
              if (b.id === highlightId) return -1;
            }
            return b.cost - a.cost;
          }).map(d => {
            const cx = scales.toX(d.totalLatency);
            const cy = scales.toY(d.passRate);
            const r = scales.toR(d.cost);
            const c = colorForWeights(d.weightsAvailable);
            const isHovered = hoveredId === d.id;
            const isHighlighted = highlightId && d.id === highlightId;
            const stroke = isHighlighted ? "#f59e0b" : c.stroke;
            const strokeWidth = isHighlighted ? 3 : (isHovered ? 2.5 : 1.5);
            const radius = (isHovered ? r + 2 : r) + (isHighlighted ? 2 : 0);
            return (
              <g key={d.id}>
                <circle
                  cx={cx} cy={cy} r={radius}
                  fill={c.fill} stroke={stroke} strokeWidth={strokeWidth}
                  style={{ transition: "r 0.15s ease, stroke-width 0.15s ease", cursor: "pointer" }}
                  onMouseEnter={() => setHoveredId(d.id)}
                  onMouseLeave={() => setHoveredId(null)}
                />
                {/* Model label - scale-compensated, hidden when overlapping */}
                {labelLayout[d.id]?.visible && (
                  <text
                    x={cx} y={cy - radius - 4 * (viewBox.w / CHART_W)}
                    textAnchor="middle"
                    fontSize={9 * (viewBox.w / CHART_W)}
                    fill={isHighlighted ? "#b45309" : "#666"}
                    fontWeight={isHighlighted ? 700 : 400}
                    style={{ pointerEvents: "none" }}
                  >
                    {labelLayout[d.id].text}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Zoom buttons */}
        <div style={{
          position: "absolute", top: 10, right: 10,
          display: "flex", flexDirection: "column", gap: 2, zIndex: 10,
        }}>
          {[
            { label: "+", factor: 0.75 },
            { label: "\u2212", factor: 1.333 },
          ].map(b => (
            <button
              key={b.label}
              onClick={(e) => { e.stopPropagation(); zoomBy(b.factor); }}
              style={{
                width: 32, height: 32, border: "1px solid #ddd", borderRadius: 6,
                background: "#fff", color: "#555", fontSize: 18, lineHeight: 1,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 600, boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "#f5f5f5"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#fff"; }}
            >
              {b.label}
            </button>
          ))}
        </div>

        {/* Tooltip */}
        {hovered && (
          <div style={{
            position: "absolute",
            left: Math.min(mousePos.x + 12, (containerRef.current?.offsetWidth || 600) - 220),
            top: mousePos.y - 10,
            background: "#fff",
            border: "1px solid #e8e6e0",
            borderRadius: 10,
            padding: "12px 16px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            pointerEvents: "none",
            zIndex: 10,
            minWidth: 180,
            fontSize: 13,
            lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 700, color: "#1a1a1a", marginBottom: 4, fontSize: 14 }}>
              {hovered.model}{hovered.modelVariant ? ` (${hovered.modelVariant})` : ''}
            </div>
            <div style={{ color: "#666" }}>
              Pass rate: <span style={{ fontWeight: 600, color: colorForWeights(hovered.weightsAvailable).stroke }}>{hovered.passRate.toFixed(0)}%</span> ({hovered.passed}/{hovered.total})
            </div>
            <div style={{ color: "#666" }}>
              Total Time: <span style={{ fontWeight: 600 }}>{hovered.totalLatency.toFixed(1)}s</span>
            </div>
            <div style={{ color: "#666" }}>
              Cost: <span style={{ fontWeight: 600 }}>{hovered.cost > 0 ? `$${hovered.cost.toFixed(4)}` : "Free"}</span>
            </div>
            {hovered.throttleTimeSec != null && (
              <div style={{ color: "#666" }}>
                Throttle: <span style={{ fontWeight: 600 }}>{hovered.throttleTimeSec}s between calls</span>
              </div>
            )}
          </div>
        )}
      </div>

      {showTitle !== false && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "#999" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              Bubble size = Cost
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <svg width={16} height={16} style={{ verticalAlign: "middle" }}>
                <circle cx={8} cy={8} r={6} fill="rgba(39,174,96,0.55)" stroke="#27AE60" strokeWidth={1} />
              </svg>
              Open weights
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <svg width={16} height={16} style={{ verticalAlign: "middle" }}>
                <circle cx={8} cy={8} r={6} fill="rgba(61,79,95,0.55)" stroke="#3D4F5F" strokeWidth={1} />
              </svg>
              Closed weights
            </span>
          </div>

          {isZoomed && (
            <button
              onClick={() => setViewBox({ ...initialViewBox })}
              style={{
                fontSize: 12, padding: "5px 14px", borderRadius: 6, border: "1px solid #ddd",
                background: "#fff", color: "#666", cursor: "pointer", fontWeight: 500,
                transition: "all 0.15s",
              }}
            >
              Reset zoom
            </button>
          )}
        </div>
      )}
    </div>
  );
}
