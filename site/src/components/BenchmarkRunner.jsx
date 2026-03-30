import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { runBenchmark } from "@fifthvertex/benchmark-core";
import { benchmarkDataset } from "@fifthvertex/benchmark-data-adventureworks";
import { BrowserDuckDbRunner } from "./browser-duckdb-runner.js";
import { createBrowserToolCallingClient, createTracingClient } from "./openai-client.js";
import ConversationTrace from "./ConversationTrace.jsx";
import AnswerRow from "./AnswerRow.jsx";
import Heatmap from "./Heatmap.jsx";
import BenchmarkSettings from "./BenchmarkSettings.jsx";

// ---------------------------------------------------------------------------
// Shared storage keys (compatible with data-analyst-component)
// ---------------------------------------------------------------------------
const OPENROUTER_PROVIDER_ID = "openrouter";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY_STORAGE = "openrouter_api_key";

const DEFAULT_CUSTOM_PROVIDERS = [
  {
    id: "ollama-default",
    name: "Ollama",
    endpoint: "http://localhost:11434/v1/",
    apiKey: "",
    enabled: false,
  },
  {
    id: "custom-default",
    name: "Custom Provider",
    endpoint: "http://localhost:11434/v1",
    apiKey: "",
    enabled: false,
  },
];

function readCustomProviders() {
  try {
    const raw = localStorage.getItem("custom_providers");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_CUSTOM_PROVIDERS;
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

function isOpenRouterEndpoint(ep) {
  return ep.trim().replace(/\/+$/, "") === OPENROUTER_ENDPOINT.replace(/\/+$/, "");
}

function findProviderIdForEndpoint(ep, customProviders) {
  if (isOpenRouterEndpoint(ep)) return OPENROUTER_PROVIDER_ID;
  const trimmed = ep.trim().replace(/\/+$/, "");
  const match = customProviders.find(
    (p) => p.endpoint.replace(/\/+$/, "") === trimmed
  );
  return match?.id || null;
}

function getApiKeyForEndpoint(ep, customProviders) {
  if (isOpenRouterEndpoint(ep)) {
    return localStorage.getItem(OPENROUTER_API_KEY_STORAGE) || "";
  }
  const trimmed = ep.trim().replace(/\/+$/, "");
  const match = customProviders.find(
    (p) => p.endpoint.replace(/\/+$/, "") === trimmed
  );
  return match?.apiKey || "";
}

export default function BenchmarkRunner() {
  const [endpoint, setEndpoint] = useState(() => localStorage.getItem("benchmarkRunner.endpoint") || "");
  const [apiKey, setApiKey] = useState(() => {
    const ep = localStorage.getItem("benchmarkRunner.endpoint") || "";
    return getApiKeyForEndpoint(ep, readCustomProviders());
  });
  const [model, setModel] = useState(() => localStorage.getItem("benchmarkRunner.model") || "");

  useEffect(() => { localStorage.setItem("benchmarkRunner.endpoint", endpoint); }, [endpoint]);
  useEffect(() => { localStorage.setItem("benchmarkRunner.model", model); }, [model]);
  const [timeoutSec, setTimeoutSec] = useState("120");

  const [selectedIds, setSelectedIds] = useState(() => new Set(
    benchmarkDataset.questions.filter(q => q.difficulty === "trivial").map(q => q.id)
  ));

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
  const [openRouterKey, setOpenRouterKey] = useState(
    () => localStorage.getItem(OPENROUTER_API_KEY_STORAGE) || ""
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showAllModels, setShowAllModels] = useState(false);
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

  // Auto-populate API key when endpoint changes (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) return;
    setApiKey(getApiKeyForEndpoint(endpoint, customProviders));
  }, [endpoint]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { isInitialMount.current = false; }, []);

  const persistApiKey = useCallback((ep, key) => {
    const trimmedEp = ep.trim();
    const trimmedKey = key.trim();
    if (!trimmedEp) return;

    if (isOpenRouterEndpoint(trimmedEp)) {
      localStorage.setItem(OPENROUTER_API_KEY_STORAGE, trimmedKey);
      setOpenRouterKey(trimmedKey);
    } else {
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
  }, []);

  const saveToHistory = useCallback((ep, key, mdl) => {
    const trimmedEp = ep.trim();
    const trimmedModel = mdl.trim();
    if (!trimmedEp) return;

    persistApiKey(ep, key);

    // Save model to saved_models_by_provider
    if (trimmedModel) {
      const providerId = findProviderIdForEndpoint(trimmedEp, customProviders);
      if (providerId) {
        setSavedModels((prev) => {
          const models = prev[providerId] || [];
          const filtered = models.filter((m) => m !== trimmedModel);
          return { ...prev, [providerId]: [trimmedModel, ...filtered] };
        });
      }
    }
  }, [customProviders, persistApiKey]);

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

  const handleAddProvider = useCallback(({ name, endpoint: ep }) => {
    const newProvider = {
      id: "custom-" + Date.now().toString(36),
      name,
      endpoint: ep,
      apiKey: "",
      enabled: true,
    };
    setCustomProviders((prev) => [...prev, newProvider]);
  }, []);

  const handleSaveProvider = useCallback(({ id, name, endpoint: ep, apiKey: key }) => {
    if (id === OPENROUTER_PROVIDER_ID) {
      localStorage.setItem(OPENROUTER_API_KEY_STORAGE, key || "");
      setOpenRouterKey(key || "");
      return;
    }
    setCustomProviders((prev) => prev.map((p) =>
      p.id === id ? { ...p, name, endpoint: ep, apiKey: key } : p
    ));
  }, []);

  const handleDeleteProvider = useCallback((providerId) => {
    if (providerId === OPENROUTER_PROVIDER_ID) return;
    setCustomProviders((prev) => {
      const deleted = prev.find((p) => p.id === providerId);
      if (deleted && endpoint.replace(/\/+$/, "") === deleted.endpoint.replace(/\/+$/, "")) {
        setEndpoint("");
        setModel("");
        setApiKey("");
      }
      return prev.filter((p) => p.id !== providerId);
    });
    setSavedModels((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
  }, [endpoint]);

  const handleAddModel = useCallback((providerId, modelName) => {
    const trimmed = modelName.trim();
    if (!trimmed) return;
    setSavedModels((prev) => {
      const models = prev[providerId] || [];
      if (models.includes(trimmed)) return prev;
      return { ...prev, [providerId]: [trimmed, ...models] };
    });
  }, []);

  // Compute all (provider, model) pairs for the dropdown
  const allEntries = useMemo(() => [
    { providerId: OPENROUTER_PROVIDER_ID, name: "OpenRouter", endpoint: OPENROUTER_ENDPOINT, apiKey: openRouterKey },
    ...customProviders.map((p) => ({ providerId: p.id, name: p.name, endpoint: p.endpoint, apiKey: p.apiKey })),
  ], [customProviders, openRouterKey]);

  const endpointModelPairs = useMemo(() => {
    const pairs = [];
    for (const entry of allEntries) {
      const models = savedModels[entry.providerId] || [];
      for (const m of models) {
        pairs.push({
          value: `${entry.providerId}::${m}`,
          label: `${entry.name} / ${m}`,
          endpoint: entry.endpoint,
          apiKey: entry.apiKey,
          model: m,
        });
      }
    }
    return pairs;
  }, [allEntries, savedModels]);

  const currentPairValue = useMemo(() => {
    const pid = findProviderIdForEndpoint(endpoint, customProviders);
    if (pid && model.trim()) return `${pid}::${model.trim()}`;
    return "";
  }, [endpoint, model, customProviders]);

  const handlePairSelect = useCallback((e) => {
    const pair = endpointModelPairs.find((p) => p.value === e.target.value);
    if (pair) {
      setEndpoint(pair.endpoint);
      setApiKey(pair.apiKey);
      setModel(pair.model);
    }
  }, [endpointModelPairs]);

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
      {/* Endpoint + model selector */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, marginBottom: 16,
        padding: "8px 12px", borderRadius: 8,
        background: "#f8f7f5", border: "1px solid #e8e6e0",
      }}>
        <select
          value={currentPairValue}
          onChange={handlePairSelect}
          disabled={busy}
          style={{
            flex: 1, minWidth: 0,
            fontSize: 12, padding: "6px 10px",
            border: "1px solid #d0cec8", borderRadius: 6,
            outline: "none",
            fontFamily: "'JetBrains Mono', monospace",
            color: "#333", background: "#fff",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {endpointModelPairs.length === 0 ? (
            <option value="">No saved models — open Settings to configure</option>
          ) : (
            <>
              {!endpointModelPairs.some((p) => p.value === currentPairValue) && (
                <option value="" disabled>Select endpoint + model</option>
              )}
              {endpointModelPairs.map((pair) => (
                <option key={pair.value} value={pair.value}>{pair.label}</option>
              ))}
            </>
          )}
        </select>
        <button
          onClick={() => setShowSettings(true)}
          disabled={busy}
          title="Settings"
          style={{
            padding: "6px 12px", borderRadius: 6,
            border: "1px solid #d0cec8", background: "#fff",
            fontSize: 16, color: "#555", cursor: busy ? "default" : "pointer",
            lineHeight: 1, flexShrink: 0,
            opacity: busy ? 0.4 : 1,
            fontWeight: 600,
          }}
        >
          ⚙ Settings
        </button>
      </div>

      {/* Interactive heatmap for question selection and results */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <label style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 12, color: "#666", cursor: "pointer",
            userSelect: "none",
          }}>
            <input
              type="checkbox"
              checked={showAllModels}
              onChange={(e) => setShowAllModels(e.target.checked)}
              style={{ margin: 0 }}
            />
            Show all models
          </label>
        </div>
        <Heatmap
          showTitle={false}
          runRow={heatmapRunRow}
          showAllModels={showAllModels}
          onToggleQuestion={busy ? undefined : toggleQuestionId}
          onSelectAll={busy ? undefined : () => setSelectedIds(new Set(questions.map((q) => q.id)))}
          onSelectNone={busy ? undefined : () => setSelectedIds(new Set())}
          onSelectDifficulty={busy ? undefined : (diff, checked) => {
            const idsForDiff = questions.filter(q => q.difficulty === diff).map(q => q.id);
            setSelectedIds(prev => {
              const next = new Set(prev);
              for (const id of idsForDiff) {
                if (checked) next.add(id); else next.delete(id);
              }
              return next;
            });
          }}
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
      {showSettings && (
        <BenchmarkSettings
          onClose={() => setShowSettings(false)}
          endpoint={endpoint}
          onEndpointChange={setEndpoint}
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          model={model}
          onModelChange={setModel}
          onDeleteModel={deleteModel}
          timeoutSec={timeoutSec}
          onTimeoutChange={setTimeoutSec}
          allEntries={allEntries}
          savedModels={savedModels}
          onSaveProvider={handleSaveProvider}
          onAddProvider={handleAddProvider}
          onDeleteProvider={handleDeleteProvider}
          onAddModel={handleAddModel}
        />
      )}
    </div>
  );
}
