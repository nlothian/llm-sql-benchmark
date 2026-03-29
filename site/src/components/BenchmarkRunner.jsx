import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { runBenchmark } from "@fifthvertex/benchmark-core";
import { benchmarkDataset } from "@fifthvertex/benchmark-data-adventureworks";
import { BrowserDuckDbRunner } from "./browser-duckdb-runner.js";
import { createBrowserToolCallingClient, createTracingClient } from "./openai-client.js";
import ConversationTrace from "./ConversationTrace.jsx";
import AnswerRow from "./AnswerRow.jsx";
import Heatmap from "./Heatmap.jsx";

const inputStyle = {
  width: "100%", padding: "8px 12px", borderRadius: 6,
  border: "1px solid #d0cec8", fontSize: 13,
  fontFamily: "'JetBrains Mono', monospace",
  outline: "none", boxSizing: "border-box",
};

const labelStyle = {
  fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4,
  display: "block",
};

// ---------------------------------------------------------------------------
// Shared storage keys (compatible with data-analyst-component)
// ---------------------------------------------------------------------------
const OPENROUTER_PROVIDER_ID = "openrouter";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY_STORAGE = "openrouter_api_key";

const LLAMACPP_DEFAULT = {
  id: "llama-cpp-default",
  name: "llama.cpp",
  endpoint: "http://localhost:8080/v1/chat/completions",
  apiKey: "",
  enabled: false,
};

function maskApiKey(key) {
  if (!key) return "Not set";
  if (key.length <= 8) return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
  return key.slice(0, 4) + "\u2022\u2022\u2022\u2022" + key.slice(-4);
}

function readCustomProviders() {
  try {
    const raw = localStorage.getItem("custom_providers");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return [LLAMACPP_DEFAULT];
}

function readSavedModels() {
  try {
    const raw = localStorage.getItem("saved_models_by_provider");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch { /* ignore */ }
  return {};
}

function findProviderIdForEndpoint(ep, customProviders) {
  const trimmed = ep.trim().replace(/\/+$/, "");
  if (trimmed === OPENROUTER_ENDPOINT.replace(/\/+$/, "")) return OPENROUTER_PROVIDER_ID;
  const match = customProviders.find(
    (p) => p.endpoint.replace(/\/+$/, "") === trimmed
  );
  return match?.id || null;
}

export default function BenchmarkRunner() {
  const [endpoint, setEndpoint] = useState(() => localStorage.getItem("benchmarkRunner.endpoint") || "");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("benchmarkRunner.apiKey") || "");
  const [model, setModel] = useState(() => localStorage.getItem("benchmarkRunner.model") || "");

  useEffect(() => { localStorage.setItem("benchmarkRunner.endpoint", endpoint); }, [endpoint]);
  useEffect(() => { localStorage.setItem("benchmarkRunner.apiKey", apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem("benchmarkRunner.model", model); }, [model]);
  const [timeoutSec, setTimeoutSec] = useState("120");

  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [status, setStatus] = useState("idle"); // idle | loading | running | done | error
  const [statusMessage, setStatusMessage] = useState("");
  const [completedResults, setCompletedResults] = useState([]);
  const [report, setReport] = useState(null);
  const [runError, setRunError] = useState(null);
  const [liveTrace, setLiveTrace] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [currentQuestionId, setCurrentQuestionId] = useState(null);
  const [openQ, setOpenQ] = useState(null);
  const traceMapRef = useRef({});
  const abortRef = useRef(null);

  // -- Shared endpoint history (compatible with data-analyst-component) --
  const [customProviders, setCustomProviders] = useState(readCustomProviders);
  const [savedModels, setSavedModels] = useState(readSavedModels);
  const [showSettings, setShowSettings] = useState(false);
  const isInitialMount = useRef(true);

  useEffect(() => {
    localStorage.setItem("custom_providers", JSON.stringify(customProviders));
  }, [customProviders]);

  useEffect(() => {
    localStorage.setItem("saved_models_by_provider", JSON.stringify(savedModels));
  }, [savedModels]);

  const clearResults = useCallback(() => {
    setCompletedResults([]);
    setReport(null);
    setRunError(null);
    setLiveTrace(null);
    setCurrentQuestion(null);
    setOpenQ(null);
    traceMapRef.current = {};
  }, []);

  // Clear results when endpoint or model changes (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) return;
    clearResults();
  }, [endpoint, model, clearResults]);

  useEffect(() => { isInitialMount.current = false; }, []);

  // Escape key closes settings overlay
  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e) => { if (e.key === "Escape") setShowSettings(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showSettings]);

  const saveToHistory = useCallback((ep, key, mdl) => {
    const trimmedEp = ep.trim();
    const trimmedKey = key.trim();
    const trimmedModel = mdl.trim();
    if (!trimmedEp) return;

    const isOpenRouter = trimmedEp.replace(/\/+$/, "") === OPENROUTER_ENDPOINT.replace(/\/+$/, "");

    if (isOpenRouter) {
      // Store OpenRouter API key in the shared built-in key
      localStorage.setItem(OPENROUTER_API_KEY_STORAGE, trimmedKey);
    } else {
      // Upsert into custom_providers
      setCustomProviders((prev) => {
        const next = prev.map((p) => ({ ...p }));
        let entry = next.find((p) => p.endpoint.replace(/\/+$/, "") === trimmedEp.replace(/\/+$/, ""));
        if (!entry) {
          entry = {
            id: "custom-" + Date.now().toString(36),
            name: trimmedEp.replace(/^https?:\/\//, "").split("/")[0],
            endpoint: trimmedEp,
            apiKey: trimmedKey,
            enabled: true,
          };
          next.push(entry);
        } else {
          entry.apiKey = trimmedKey;
        }
        return next;
      });
    }

    // Save model to saved_models_by_provider
    if (trimmedModel) {
      const providerId = isOpenRouter
        ? OPENROUTER_PROVIDER_ID
        : findProviderIdForEndpoint(trimmedEp, customProviders);
      if (providerId) {
        setSavedModels((prev) => {
          const models = prev[providerId] || [];
          const filtered = models.filter((m) => m !== trimmedModel);
          return { ...prev, [providerId]: [trimmedModel, ...filtered] };
        });
      }
    }
  }, [customProviders]);

  const deleteModel = useCallback((providerId, modelName) => {
    setSavedModels((prev) => {
      const models = (prev[providerId] || []).filter((m) => m !== modelName);
      const next = { ...prev };
      if (models.length === 0) delete next[providerId];
      else next[providerId] = models;
      return next;
    });
    if (model.trim() === modelName) setModel("");
  }, [model]);

  const questions = benchmarkDataset.questions;

  const resultsMap = useMemo(() => {
    const map = new Map();
    for (const r of completedResults) {
      const trace = traceMapRef.current[r.question.id];
      map.set(r.question.id, {
        status: r.status,
        cost: r.cost,
        durationMs: r.durationMs,
        attempts: r.attempts,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        sql: r.generatedSql,
        check: r.check,
        error: r.error,
        calls: trace?.calls || [],
        systemPrompt: trace?.systemPrompt || null,
      });
    }
    return map;
  }, [completedResults]);

  // Only run questions that are selected but don't already have results
  const questionIds = useMemo(() =>
    [...selectedIds].filter(id => !resultsMap.has(id)),
    [selectedIds, resultsMap]
  );

  const canRun = endpoint.trim() && model.trim() && status !== "running" && status !== "loading" && questionIds.length > 0;

  const heatmapRunRow = useMemo(() => ({
    model: model || "Your model",
    selectedIds,
    results: resultsMap,
    currentQuestionId,
  }), [model, selectedIds, resultsMap, currentQuestionId]);

  const toggleQuestionId = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRun = useCallback(async () => {
    saveToHistory(endpoint, apiKey, model);
    setRunError(null);
    setReport(null);
    setLiveTrace(null);
    setCurrentQuestion(null);
    setCurrentQuestionId(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setStatus("loading");
      setStatusMessage("Initializing DuckDB...");

      const runner = await BrowserDuckDbRunner.create();

      setStatusMessage("Loading dataset tables...");
      await runner.loadDataset(benchmarkDataset);

      const baseClient = createBrowserToolCallingClient({
        endpoint: endpoint.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
      });

      const tracingClient = createTracingClient(baseClient, ({ phase, systemPrompt, call }) => {
        setLiveTrace((prev) => {
          const sp = systemPrompt || prev?.systemPrompt || null;
          if (phase === "started") {
            // Append the pending call
            return { systemPrompt: sp, calls: [...(prev?.calls || []), call], error: null };
          }
          // phase === "completed": replace the last (pending) call
          const calls = [...(prev?.calls || [])];
          calls[calls.length - 1] = call;
          return { systemPrompt: sp, calls, error: null };
        });
      });

      setStatus("running");
      setStatusMessage("");

      const result = await runBenchmark({
        dataset: benchmarkDataset,
        runner,
        client: tracingClient,
        timeoutMs: (parseInt(timeoutSec, 10) || 120) * 1000,
        questionIds,
        abortSignal: controller.signal,
        onEvent: (event) => {
          if (event.type === "run-started") {
            setStatusMessage(`Running ${event.totalQuestions} question(s)...`);
          } else if (event.type === "question-started") {
            tracingClient.reset();
            setLiveTrace({ calls: [], systemPrompt: null, error: null });
            setCurrentQuestion(event.question);
            setCurrentQuestionId(event.question.id);
            setStatusMessage(
              `[Q${event.question.id}] (${event.index + 1}/${event.total}) ${event.question.question.slice(0, 60)}...`
            );
          } else if (event.type === "question-completed") {
            setCurrentQuestionId(null);
            setLiveTrace((prev) => {
              const snapshot = prev ? { ...prev } : { calls: [], systemPrompt: null, error: null };
              if (event.record.error) snapshot.error = event.record.error;
              traceMapRef.current[event.record.question.id] = snapshot;
              return snapshot;
            });
            setCompletedResults((prev) => [...prev, event.record]);
          } else if (event.type === "status") {
            setStatusMessage(event.message);
          }
        },
      });

      setReport(result);
      setStatus("done");
      setStatusMessage("");
      setCurrentQuestionId(null);
    } catch (err) {
      const isAbort =
        err.name === "AbortError" ||
        err.name === "RunAbortedError" ||
        err.message === "Benchmark run aborted" ||
        (typeof err.message === "string" && err.message.includes("The operation was aborted"));
      if (isAbort) {
        setStatus("done");
        setStatusMessage("Aborted.");
      } else {
        setRunError(err.message || String(err));
        setStatus("error");
        setStatusMessage("");
      }
    } finally {
      abortRef.current = null;
    }
  }, [endpoint, apiKey, model, timeoutSec, questionIds, saveToHistory]);

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const busy = status === "loading" || status === "running";

  return (
    <div style={{
      borderRadius: 10, border: "1px solid #e8e6e0", background: "#fff",
      padding: "20px 24px", margin: "16px 0",
    }}>
      {/* Config summary + settings cog */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, marginBottom: 16,
        padding: "8px 12px", borderRadius: 8,
        background: "#f8f7f5", border: "1px solid #e8e6e0",
      }}>
        <button
          onClick={() => setShowSettings(true)}
          disabled={busy}
          title="Settings"
          style={{
            background: "none", border: "none",
            fontSize: 18, color: "#666", cursor: busy ? "default" : "pointer",
            padding: 0, lineHeight: 1, flexShrink: 0,
            opacity: busy ? 0.4 : 1,
          }}
        >
          ⚙
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          {endpoint.trim() ? (
            <div style={{
              fontSize: 12, color: "#333",
              fontFamily: "'JetBrains Mono', monospace",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {endpoint.trim()}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#999", fontStyle: "italic" }}>
              No endpoint configured
            </div>
          )}
          {model.trim() ? (
            <div style={{
              fontSize: 11, color: "#666",
              fontFamily: "'JetBrains Mono', monospace",
              marginTop: 1,
            }}>
              {model.trim()}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "#999", fontStyle: "italic", marginTop: 1 }}>
              No model selected
            </div>
          )}
        </div>
      </div>

      {/* Interactive heatmap for question selection and results */}
      <div style={{ marginBottom: 16 }}>
        <Heatmap
          showTitle={false}
          runRow={heatmapRunRow}
          onToggleQuestion={busy ? undefined : toggleQuestionId}
          onSelectAll={busy ? undefined : () => setSelectedIds(new Set(questions.map((q) => q.id)))}
          onSelectNone={busy ? undefined : () => setSelectedIds(new Set())}
        />
      </div>

      {/* Run / Abort */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button
          onClick={handleRun}
          disabled={!canRun}
          style={{
            padding: "8px 24px", borderRadius: 6, border: "none",
            background: canRun ? "#1a1a1a" : "#ccc",
            color: "#fff", fontSize: 13, fontWeight: 600,
            cursor: canRun ? "pointer" : "default",
            fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif",
          }}
        >
          {busy ? "Running..." : "Run Benchmark"}
        </button>
        {busy && (
          <button
            onClick={handleAbort}
            style={{
              padding: "8px 18px", borderRadius: 6,
              border: "1px solid #d0cec8", background: "#fff",
              color: "#791f1f", fontSize: 12, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Abort
          </button>
        )}
        {!busy && completedResults.length > 0 && (
          <button
            onClick={clearResults}
            style={{
              padding: "8px 18px", borderRadius: 6,
              border: "1px solid #d0cec8", background: "#fff",
              color: "#555", fontSize: 12, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Clear Results
          </button>
        )}
        {statusMessage && (
          <span style={{ fontSize: 12, color: "#888" }}>{statusMessage}</span>
        )}
      </div>

      {/* Live conversation trace */}
      {liveTrace && liveTrace.calls.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {currentQuestion && (
            <div style={{
              fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4,
            }}>
              <span style={{
                fontFamily: "monospace", fontWeight: 700, color: "#666", marginRight: 8,
              }}>
                Q{currentQuestion.id}
              </span>
              {currentQuestion.question}
            </div>
          )}
          <ConversationTrace trace={liveTrace} defaultOpen />
        </div>
      )}

      {/* Error */}
      {runError && (
        <div style={{
          marginBottom: 16, padding: "10px 14px", borderRadius: 8,
          background: "#fcebeb", border: "1px solid #f09595",
          color: "#791f1f", fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {runError}
        </div>
      )}

      {/* Live results */}
      {completedResults.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#333", marginBottom: 8 }}>
            Results
          </div>
          {completedResults.map((r) => {
            const trace = traceMapRef.current[r.question.id];
            return (
              <AnswerRow
                key={r.question.id}
                result={{
                  id: r.question.id,
                  question: r.question.question,
                  difficulty: r.question.difficulty,
                  status: r.status,
                  durationMs: r.durationMs,
                  attempts: r.attempts,
                  sql: r.generatedSql,
                  cost: r.cost,
                  error: r.error,
                  check: r.check,
                  calls: trace?.calls || [],
                }}
                isOpen={openQ === r.question.id}
                onToggle={() => setOpenQ(openQ === r.question.id ? null : r.question.id)}
                systemPrompt={trace?.systemPrompt || null}
                referenceSql={r.question.sql}
                includedTables={r.question.included_tables ?? null}
              />
            );
          })}
        </div>
      )}

      {/* Summary */}
      {report && (
        <div style={{
          padding: "14px 18px", borderRadius: 8,
          background: "#f8f7f5", border: "1px solid #e8e6e0",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
            Summary
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13 }}>
            <span>
              <strong style={{ color: "#2d6e36" }}>{report.summary.passed}</strong> passed
            </span>
            <span>
              <strong style={{ color: "#791f1f" }}>{report.summary.failed}</strong> failed
            </span>
            <span>
              <strong style={{ color: "#8a5d00" }}>{report.summary.errored}</strong> errored
            </span>
            <span>
              of <strong>{report.summary.total}</strong> total
            </span>
          </div>
          {(report.summary.totalInputTokens > 0 || report.summary.totalOutputTokens > 0) && (
            <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
              Tokens: {report.summary.totalInputTokens} input, {report.summary.totalOutputTokens} output
              {report.summary.totalCost != null && ` — $${report.summary.totalCost.toFixed(6)}`}
            </div>
          )}
          {report.meta.durationMs != null && (
            <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
              Duration: {(report.meta.durationMs / 1000).toFixed(1)}s
            </div>
          )}
        </div>
      )}

      {/* Settings overlay */}
      {showSettings && (() => {
        const openRouterKey = localStorage.getItem(OPENROUTER_API_KEY_STORAGE) || "";
        const allEntries = [
          { providerId: OPENROUTER_PROVIDER_ID, name: "OpenRouter", endpoint: OPENROUTER_ENDPOINT, apiKey: openRouterKey },
          ...customProviders.map((p) => ({ providerId: p.id, name: p.name, endpoint: p.endpoint, apiKey: p.apiKey })),
        ];
        const currentProviderId = findProviderIdForEndpoint(endpoint, customProviders);
        const currentModels = currentProviderId ? (savedModels[currentProviderId] || []) : [];
        return (
          <div
            onClick={() => setShowSettings(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 9999,
              background: "rgba(0, 0, 0, 0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 32,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#fff", borderRadius: 12,
                maxWidth: 540, width: "100%",
                maxHeight: "90vh", overflow: "auto",
                boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
              }}
            >
              {/* Header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "16px 20px", borderBottom: "1px solid #e8e6e0",
                position: "sticky", top: 0, background: "#fff", zIndex: 1,
                borderRadius: "12px 12px 0 0",
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>
                  Benchmark Settings
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  style={{
                    background: "none", border: "none", fontSize: 20,
                    color: "#999", cursor: "pointer", padding: "4px 8px", lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ padding: "16px 20px" }}>
                {/* ── Section: Connection ── */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
                    Connection
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={labelStyle}>API Endpoint</label>
                    <input
                      type="url"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder="https://your-api.example.com/v1/chat/completions"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>API Key (optional)</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Bearer token"
                      style={inputStyle}
                    />
                  </div>
                </div>

                {/* ── Section: Models ── */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
                    Model
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <input
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="e.g. gpt-4o, qwen3.5-27b"
                      style={inputStyle}
                    />
                  </div>
                  {currentModels.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
                        Saved models for this endpoint:
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {currentModels.map((m) => {
                          const isSelected = m === model.trim();
                          return (
                            <span
                              key={m}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 4,
                                fontSize: 11, padding: "3px 8px", borderRadius: 4,
                                background: isSelected ? "#185fa5" : "#e8e6e0",
                                color: isSelected ? "#fff" : "#555",
                                fontFamily: "'JetBrains Mono', monospace",
                              }}
                            >
                              <span
                                onClick={() => setModel(m)}
                                style={{ cursor: "pointer" }}
                              >
                                {m}
                              </span>
                              <span
                                onClick={() => deleteModel(currentProviderId, m)}
                                style={{
                                  cursor: "pointer", marginLeft: 2,
                                  opacity: 0.6, fontSize: 10, lineHeight: 1,
                                }}
                                title={`Remove ${m}`}
                              >
                                ✕
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Section: Timeout ── */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>Timeout (seconds)</label>
                    <input
                      type="number"
                      value={timeoutSec}
                      onChange={(e) => setTimeoutSec(e.target.value)}
                      min="10"
                      max="600"
                      style={{ ...inputStyle, width: 80 }}
                    />
                  </div>
                </div>

                {/* ── Section: Saved Endpoints ── */}
                <div>
                  <div style={{
                    fontSize: 12, fontWeight: 700, color: "#1a1a1a", marginBottom: 8,
                    paddingTop: 12, borderTop: "1px solid #e8e6e0",
                  }}>
                    Saved Endpoints
                  </div>
                  {allEntries.map((entry) => {
                    const isActive = entry.endpoint.replace(/\/+$/, "") === endpoint.trim().replace(/\/+$/, "");
                    const models = savedModels[entry.providerId] || [];
                    return (
                      <div
                        key={entry.providerId}
                        onClick={() => {
                          setEndpoint(entry.endpoint);
                          setApiKey(entry.apiKey);
                          if (models.length > 0) setModel(models[0]);
                        }}
                        style={{
                          padding: "10px 14px", borderRadius: 8, marginBottom: 8,
                          border: isActive ? "2px solid #185fa5" : "1px solid #e8e6e0",
                          background: isActive ? "rgba(24, 95, 165, 0.04)" : "#fafafa",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a" }}>
                            {entry.name}
                          </div>
                          <div style={{ fontSize: 11, color: "#888" }}>
                            {maskApiKey(entry.apiKey)}
                          </div>
                        </div>
                        <div style={{
                          fontSize: 11, color: "#666", marginTop: 2,
                          fontFamily: "'JetBrains Mono', monospace",
                          wordBreak: "break-all",
                        }}>
                          {entry.endpoint}
                        </div>
                        {models.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                            {models.map((m) => (
                              <span
                                key={m}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEndpoint(entry.endpoint);
                                  setApiKey(entry.apiKey);
                                  setModel(m);
                                }}
                                style={{
                                  fontSize: 11, padding: "2px 8px", borderRadius: 4,
                                  background: m === model.trim() && isActive ? "#185fa5" : "#e8e6e0",
                                  color: m === model.trim() && isActive ? "#fff" : "#555",
                                  cursor: "pointer",
                                  fontFamily: "'JetBrains Mono', monospace",
                                }}
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
