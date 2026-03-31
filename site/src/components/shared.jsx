import { useMemo } from "react";
import { format } from "sql-formatter";
import { parseJsonlText } from "./parseLogData.js";
import { fetchGz } from "./fetchGz.js";

export const DIFF_COLORS = {
  trivial: { bg: "#e6f4e8", text: "#2d6e36", border: "#97C459" },
  easy: { bg: "#e1f5ee", text: "#0f6e56", border: "#5DCAA5" },
  medium: { bg: "#e6f1fb", text: "#185fa5", border: "#85B7EB" },
  hard: { bg: "#eeedfe", text: "#534ab7", border: "#AFA9EC" },
};

export function formatSQL(sql) {
  if (!sql) return "";
  try {
    return format(sql, {
      language: "duckdb",
      keywordCase: "upper",
    });
  } catch (err) {
    console.warn("SQL formatting failed:", err);
    return sql;
  }
}

export const getPrefix = (m) => {
  const parts = m.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
};

export const shortModel = (m) => {
  const parts = m.split("/");
  const last = parts[parts.length - 1];
  const [name, tag] = last.split(":");
  if (!tag) return name;
  if (tag === "free" || name.includes("GGUF")) return `${name}:${tag}`;
  return name;
};

export const compactModelName = (shortName, modelVariant) => {
  const fullDisplay = shortName + (modelVariant ? ` (${modelVariant})` : '');
  if (fullDisplay.length <= 40) return fullDisplay;

  // Match: <prefix with digitB>-<middle>-GGUF:<tag>  or  <prefix with digitB>-<middle>:<Qtag>
  const match = shortName.match(/^(.+?\d+B)-(.+?)(-GGUF)(:.+)$/)
             || shortName.match(/^(.+?\d+B)-(.+?)()(:[Qq].+)$/);
  if (!match) return fullDisplay;

  const [, prefix, middle, ggufSuffix, tag] = match;
  const abbreviated = middle.match(/[A-Z]|\d+(?:\.\d+)?/g);
  if (!abbreviated) return fullDisplay;

  const compacted = prefix + '-' + abbreviated.join('') + (ggufSuffix ? '-GGUF' : '') + tag;
  return compacted + (modelVariant ? ` (${modelVariant})` : '');
};

export async function loadBenchmarkWithLogs(benchmarkFile, logFile) {
  const [benchRes, logRes] = await Promise.all([
    fetchGz(`/data/benchmarks/${benchmarkFile}`),
    logFile ? fetchGz(`/data/logs/${logFile}`) : Promise.resolve(null),
  ]);
  if (!benchRes.ok) throw new Error(`Failed to load benchmark: ${benchRes.status}`);
  const benchData = await benchRes.json();

  let systemPrompt = null;
  let callsPerQuestion = {};

  if (logRes?.ok) {
    try {
      const logText = await logRes.text();
      const parsed = parseJsonlText(logText);
      systemPrompt = parsed.systemPrompt;
      callsPerQuestion = parsed.callsPerQuestion;
    } catch { /* continue without conversation data */ }
  }

  return { benchData, systemPrompt, callsPerQuestion };
}

/**
 * Parse a benchmark error string into structured limit information.
 * Returns null if the error doesn't match a known limit pattern.
 */
export function parseLimitError(error) {
  if (!error) return null;

  const sqlRetryMatch = error.match(/^Query failed after (\d+) retries: (.+)$/s);
  if (sqlRetryMatch) {
    const maxRetries = parseInt(sqlRetryMatch[1], 10);
    return {
      type: "sql-retries",
      label: "SQL retry limit reached",
      detail: `${maxRetries + 1} of ${maxRetries + 1} SQL attempts used`,
      sqlError: sqlRetryMatch[2],
    };
  }

  const toolCallMatch = error.match(/^Exceeded maximum tool calls \((\d+)\)$/);
  if (toolCallMatch) {
    const max = parseInt(toolCallMatch[1], 10);
    return {
      type: "tool-calls",
      label: "Tool call limit reached",
      detail: `${max} of ${max} LLM calls used`,
      maxCalls: max,
      sqlError: null,
    };
  }

  const noToolCallMatch = error.match(/^No tool call in response after (\d+) attempts$/);
  if (noToolCallMatch) {
    const max = parseInt(noToolCallMatch[1], 10);
    return {
      type: "no-tool-call",
      label: "Tool call retry limit reached",
      detail: `Model failed to produce a tool call in ${max} consecutive attempts`,
      sqlError: null,
    };
  }

  return null;
}

export function CodeBlock({ code, language }) {
  const formattedCode = useMemo(() => (language?.toLowerCase() === "sql") ? formatSQL(code) : code, [code, language]);
  return (
    <pre style={{
      background: "#1e1e2e", color: "#cdd6f4", padding: "14px 16px", borderRadius: 8,
      fontSize: 12.5, lineHeight: 1.6, height: 110, overflowX: "auto", margin: "8px 0",
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      border: "1px solid #313244", whiteSpace: "pre-wrap", wordBreak: "break-word",
      resize: "vertical"
    }}>
      <code style={{ outline: "none" }}>
        {formattedCode}
      </code>
    </pre>
  );
}

export function LimitErrorBlock({ limit, style }) {
  return (
    <div style={{
      background: "#fcebeb", borderRadius: 8, padding: "10px 14px",
      fontSize: 13, lineHeight: 1.6, border: "1.5px solid #f09595", color: "#791f1f",
      ...style,
    }}>
      <div style={{ fontWeight: 600, color: "#a32d2d", marginBottom: 2 }}>{limit.label}</div>
      <div style={{ fontSize: 12, color: "#994040" }}>{limit.detail}</div>
      {limit.sqlError && (
        <div style={{ marginTop: 6, padding: "6px 10px", background: "#f8dada", borderRadius: 6, fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
          {limit.sqlError}
        </div>
      )}
    </div>
  );
}
