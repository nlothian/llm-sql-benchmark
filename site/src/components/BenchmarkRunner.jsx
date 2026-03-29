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
  }, [endpoint, apiKey, model, timeoutSec, questionIds]);

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const busy = status === "loading" || status === "running";

  return (
    <div style={{
      borderRadius: 10, border: "1px solid #e8e6e0", background: "#fff",
      padding: "20px 24px", margin: "16px 0",
    }}>
      {/* Warning banner */}
      <div style={{
        padding: "10px 14px", borderRadius: 8, marginBottom: 16,
        background: "#fff3e0", border: "1px solid #ffe0b2", fontSize: 12, color: "#8a5d00",
      }}>
        Your API endpoint must support CORS (cross-origin requests from the browser).
        Your API key is sent directly to your endpoint and never stored.
      </div>

      {/* Config form */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>API Endpoint</label>
          <input
            type="url"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="https://your-api.example.com/v1/chat/completions"
            disabled={busy}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Model</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. gpt-4o, qwen3.5-27b"
            disabled={busy}
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
            disabled={busy}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Timeout (seconds)</label>
          <input
            type="number"
            value={timeoutSec}
            onChange={(e) => setTimeoutSec(e.target.value)}
            min="10"
            max="600"
            disabled={busy}
            style={{ ...inputStyle, width: 120 }}
          />
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
            onClick={() => {
              setCompletedResults([]);
              setReport(null);
              setRunError(null);
              setLiveTrace(null);
              setCurrentQuestion(null);
              setOpenQ(null);
              traceMapRef.current = {};
            }}
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
    </div>
  );
}
