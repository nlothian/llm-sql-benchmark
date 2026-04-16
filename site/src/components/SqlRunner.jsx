import { useState, useCallback, useRef, useEffect } from "react";
import { getDB, ensureTablesLoaded, runSQL } from "./duckdb-wasm.js";
import { formatSQL } from "./shared.jsx";

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

function ResultTable({ columns, rows }) {
  return (
    <div style={{ overflowX: "auto", margin: "8px 0", borderRadius: 8, border: "1px solid #e8e6e0" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontFamily: "'JetBrains Mono', monospace" }}>
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={i} style={{
                padding: "8px 12px", textAlign: "left", background: "#f8f7f5",
                color: "#888", fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                letterSpacing: 0.3, borderBottom: "2px solid #e8e6e0",
                whiteSpace: "nowrap"
              }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((val, ci) => (
                <td key={ci} style={{
                  padding: "6px 12px", borderBottom: "1px solid #f0eeea",
                  background: ri % 2 === 0 ? "#fff" : "#fafaf8",
                  color: val === null || val === undefined ? "#ccc" : "#333",
                  fontStyle: val === null || val === undefined ? "italic" : "normal",
                  whiteSpace: "nowrap"
                }}>
                  {val === null || val === undefined ? "NULL" : String(val)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SqlRunner({ tables = [], defaultSql = "", title = "SQL Query Runner" }) {
  const [sql, setSql] = useState(defaultSql);
  const [status, setStatus] = useState("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [resultOpen, setResultOpen] = useState(true);
  const codeRef = useRef(null);

  useEffect(() => {
    let initialSql = defaultSql;
    if (defaultSql) {
      initialSql = formatSQL(defaultSql);
    }
    setSql(initialSql);
    if (codeRef.current) {
      codeRef.current.innerText = initialSql;
    }
  }, [defaultSql]);

  const handleRun = useCallback(async () => {
    const currentSql = codeRef.current ? codeRef.current.innerText : sql;
    if (!currentSql.trim()) return;
    setError(null);
    setResult(null);

    try {
      setStatus("loading");
      setStatusMessage("Initializing DuckDB...");
      const db = await getDB();

      setStatusMessage(`Loading ${tables.length} table(s)...`);
      await ensureTablesLoaded(db, tables);

      setStatus("running");
      setStatusMessage("Running query...");
      const res = await runSQL(db, currentSql);
      setResult(res);
      setResultOpen(true);
      setStatus("done");
      setStatusMessage("");
    } catch (err) {
      setError(err.message || String(err));
      setStatus("error");
      setStatusMessage("");
    }
  }, [sql, tables]);

  const handleFormat = useCallback(() => {
    const currentSql = codeRef.current ? codeRef.current.innerText : sql;
    if (!currentSql.trim()) return;
    const formatted = formatSQL(currentSql);
    setSql(formatted);
    if (codeRef.current) {
      codeRef.current.innerText = formatted;
    }
  }, [sql]);

  const handleKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleRun();
    }
  }, [handleRun]);

  const busy = status === "loading" || status === "running";

  return (
    <div style={{
      borderRadius: 10, border: "1px solid #e8e6e0", background: "#fff",
      padding: "16px 20px", margin: "16px 0"
    }}>
      {title && (
        <div style={{
          fontSize: 14, fontWeight: 600, color: "#1a1a1a", marginBottom: 8
        }}>
          {title}
        </div>
      )}

      {tables.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#999", alignSelf: "center" }}>Tables:</span>
          {tables.map((t) => <TableBadge key={t} name={t} />)}
        </div>
      )}

      <pre
        style={{
          background: "#1e1e2e", color: "#cdd6f4", padding: "14px 16px", borderRadius: 8,
          fontSize: 12.5, lineHeight: 1.6, height: 100, overflow: "auto",
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          border: "1px solid #313244", whiteSpace: "pre-wrap", wordBreak: "break-word",
          resize: "vertical"
        }}
      >
        <code
          ref={codeRef}
          contentEditable={!busy}
          onInput={(e) => setSql(e.currentTarget.innerText)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          suppressContentEditableWarning={true}
          style={{ outline: "none" }}
        />
      </pre>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        <button
          onClick={handleRun}
          disabled={busy || !sql.trim()}
          style={{
            padding: "6px 18px", borderRadius: 6, border: "none",
            background: busy || !sql.trim() ? "#ccc" : "#1a1a1a",
            color: "#fff", fontSize: 12.5, fontWeight: 600,
            cursor: busy || !sql.trim() ? "default" : "pointer",
            fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif"
          }}
        >
          {busy ? "Running..." : "Run Query"}
        </button>
        <button
          onClick={handleFormat}
          disabled={busy || !sql.trim()}
          style={{
            padding: "6px 18px", borderRadius: 6, border: "1px solid #e8e6e0",
            background: "#fff", color: "#666", fontSize: 12.5, fontWeight: 600,
            cursor: busy || !sql.trim() ? "default" : "pointer",
            fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif"
          }}
        >
          Format
        </button>
        <span style={{ fontSize: 11, color: "#999" }}>
          {busy ? statusMessage : "Ctrl+Enter to run"}
        </span>
      </div>

      {error && (
        <div style={{
          marginTop: 12, padding: "10px 14px", borderRadius: 8,
          background: "#fcebeb", border: "1px solid #f09595",
          color: "#791f1f", fontSize: 12.5,
          fontFamily: "'JetBrains Mono', monospace",
          whiteSpace: "pre-wrap", wordBreak: "break-word"
        }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12 }}>
          <div
            onClick={() => setResultOpen((o) => !o)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              cursor: "pointer", userSelect: "none", marginBottom: resultOpen ? 4 : 0
            }}
          >
            <span style={{
              display: "inline-block", fontSize: 10, color: "#999",
              transition: "transform 0.15s ease",
              transform: resultOpen ? "rotate(90deg)" : "rotate(0deg)"
            }}>
              {"\u25B6"}
            </span>
            <span style={{ fontSize: 11, color: "#999" }}>
              {result.numRows} row{result.numRows !== 1 ? "s" : ""}, {result.columns.length} column{result.columns.length !== 1 ? "s" : ""} — {result.elapsed.toFixed(0)}ms
            </span>
          </div>
          {resultOpen && (
            <>
              {result.numRows > 0 ? (
                <ResultTable columns={result.columns} rows={result.rows.slice(0, 200)} />
              ) : (
                <div style={{ fontSize: 12.5, color: "#999", fontStyle: "italic" }}>
                  Query returned no rows.
                </div>
              )}
              {result.numRows > 200 && (
                <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
                  Showing first 200 of {result.numRows} rows.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
