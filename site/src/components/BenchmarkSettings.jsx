import { useState, useEffect, useMemo, useRef } from "react";

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

const OPENROUTER_PROVIDER_ID = "openrouter";

export default function BenchmarkSettings({
  onClose,
  endpoint, onEndpointChange,
  apiKey, onApiKeyChange,
  model, onModelChange,
  onDeleteModel,
  timeoutSec, onTimeoutChange,
  allEntries, savedModels,
  onSaveProvider, onAddProvider, onDeleteProvider, onAddModel,
}) {
  // Find provider matching the active endpoint
  const activeProviderId = useMemo(() => {
    const trimmed = endpoint.trim().replace(/\/+$/, "");
    const match = allEntries.find(
      (e) => e.endpoint.replace(/\/+$/, "") === trimmed
    );
    return match?.providerId || null;
  }, [endpoint, allEntries]);

  const [selectedProviderId, setSelectedProviderId] = useState(
    () => activeProviderId || (allEntries.length > 0 ? allEntries[0].providerId : null)
  );
  const [newModelInput, setNewModelInput] = useState("");
  const [addingProvider, setAddingProvider] = useState(false);
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderEndpoint, setNewProviderEndpoint] = useState("");

  // Editing state for the selected provider's fields
  const selectedEntry = useMemo(
    () => allEntries.find((e) => e.providerId === selectedProviderId) || null,
    [allEntries, selectedProviderId]
  );
  const [editApiKey, setEditApiKey] = useState(selectedEntry?.apiKey || "");
  const [editName, setEditName] = useState(selectedEntry?.name || "");
  const [editEndpoint, setEditEndpoint] = useState(selectedEntry?.endpoint || "");

  // Sync edit fields when selection changes
  useEffect(() => {
    if (selectedEntry) {
      setEditApiKey(selectedEntry.apiKey);
      setEditName(selectedEntry.name);
      setEditEndpoint(selectedEntry.endpoint);
    }
  }, [selectedProviderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // If a provider was just added, select it
  const prevCountRef = useRef(allEntries.length);
  useEffect(() => {
    if (allEntries.length > prevCountRef.current) {
      setSelectedProviderId(allEntries[allEntries.length - 1].providerId);
    }
    prevCountRef.current = allEntries.length;
  }, [allEntries]);

  const selectedModels = selectedProviderId ? (savedModels[selectedProviderId] || []) : [];
  const isOpenRouter = selectedProviderId === OPENROUTER_PROVIDER_ID;

  // Escape key closes overlay
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = () => {
    if (!selectedEntry) return;
    onSaveProvider({
      id: selectedProviderId,
      name: isOpenRouter ? selectedEntry.name : editName,
      endpoint: isOpenRouter ? selectedEntry.endpoint : editEndpoint,
      apiKey: editApiKey,
    });
  };

  const handleAddModelSubmit = () => {
    const trimmed = newModelInput.trim();
    if (!trimmed || !selectedProviderId) return;
    onAddModel(selectedProviderId, trimmed);
    setNewModelInput("");
  };

  const handleAddProviderSubmit = () => {
    const name = newProviderName.trim();
    const ep = newProviderEndpoint.trim();
    if (!name || !ep) return;
    onAddProvider({ name, endpoint: ep });
    setNewProviderName("");
    setNewProviderEndpoint("");
    setAddingProvider(false);
  };

  return (
    <div
      onClick={onClose}
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
          maxWidth: 750, width: "100%",
          maxHeight: "90vh", overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: "1px solid #e8e6e0",
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>
            Benchmark Settings
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", fontSize: 20,
              color: "#999", cursor: "pointer", padding: "4px 8px", lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Two-pane body */}
        <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* Left pane: provider list */}
          <div style={{
            width: 220, flexShrink: 0,
            borderRight: "1px solid #e8e6e0",
            background: "#fafaf9",
            overflowY: "auto",
            display: "flex", flexDirection: "column",
          }}>
            <div style={{ flex: 1, padding: "8px 0" }}>
              {allEntries.map((entry) => {
                const isSelected = entry.providerId === selectedProviderId;
                return (
                  <div
                    key={entry.providerId}
                    onClick={() => setSelectedProviderId(entry.providerId)}
                    style={{
                      padding: "10px 12px",
                      borderLeft: isSelected ? "3px solid #185fa5" : "3px solid transparent",
                      background: isSelected ? "rgba(24, 95, 165, 0.06)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>
                      {entry.name}
                    </div>
                    <div style={{
                      fontSize: 10, color: "#888", marginTop: 2,
                      fontFamily: "'JetBrains Mono', monospace",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {entry.endpoint}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add provider */}
            <div style={{ borderTop: "1px solid #e8e6e0", padding: "8px 12px" }}>
              {addingProvider ? (
                <div>
                  <input
                    type="text"
                    value={newProviderName}
                    onChange={(e) => setNewProviderName(e.target.value)}
                    placeholder="Provider name"
                    style={{ ...inputStyle, fontSize: 11, padding: "5px 8px", marginBottom: 4 }}
                    autoFocus
                  />
                  <input
                    type="url"
                    value={newProviderEndpoint}
                    onChange={(e) => setNewProviderEndpoint(e.target.value)}
                    placeholder="https://..."
                    style={{ ...inputStyle, fontSize: 11, padding: "5px 8px", marginBottom: 6 }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddProviderSubmit(); }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={handleAddProviderSubmit}
                      disabled={!newProviderName.trim() || !newProviderEndpoint.trim()}
                      style={{
                        fontSize: 11, padding: "4px 10px", borderRadius: 4,
                        border: "none", background: "#1a1a1a", color: "#fff",
                        cursor: "pointer", fontWeight: 600,
                        opacity: (!newProviderName.trim() || !newProviderEndpoint.trim()) ? 0.4 : 1,
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setAddingProvider(false); setNewProviderName(""); setNewProviderEndpoint(""); }}
                      style={{
                        fontSize: 11, padding: "4px 10px", borderRadius: 4,
                        border: "1px solid #d0cec8", background: "#fff", color: "#555",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setAddingProvider(true)}
                  style={{
                    width: "100%", padding: "6px 0",
                    fontSize: 11, fontWeight: 600, color: "#185fa5",
                    background: "none", border: "none", cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  + Add Provider
                </button>
              )}
            </div>
          </div>

          {/* Right pane: provider settings + models */}
          <div style={{
            flex: 1, minWidth: 0,
            overflowY: "auto",
            padding: "16px 20px",
          }}>
            {selectedEntry ? (
              <>
                {/* Provider name + endpoint (editable for custom, read-only for OpenRouter) */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    marginBottom: 12,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>
                      {isOpenRouter ? selectedEntry.name : editName}
                    </div>
                    {!isOpenRouter && (
                      <button
                        onClick={() => {
                          onDeleteProvider(selectedProviderId);
                          setSelectedProviderId(allEntries[0]?.providerId || null);
                        }}
                        title="Delete provider"
                        style={{
                          background: "none", border: "none",
                          fontSize: 12, color: "#999", cursor: "pointer",
                          padding: "2px 6px",
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  {!isOpenRouter && (
                    <>
                      <div style={{ marginBottom: 8 }}>
                        <label style={labelStyle}>Provider Name</label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={handleSave}
                          style={inputStyle}
                        />
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <label style={labelStyle}>Endpoint URL</label>
                        <input
                          type="url"
                          value={editEndpoint}
                          onChange={(e) => setEditEndpoint(e.target.value)}
                          onBlur={handleSave}
                          placeholder="https://your-api.example.com/v1/chat/completions"
                          style={inputStyle}
                        />
                      </div>
                    </>
                  )}

                  {isOpenRouter && (
                    <div style={{
                      fontSize: 11, color: "#888", marginBottom: 8,
                      fontFamily: "'JetBrains Mono', monospace",
                      wordBreak: "break-all",
                    }}>
                      {selectedEntry.endpoint}
                    </div>
                  )}
                </div>

                {/* API Key */}
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>API Key (optional)</label>
                  <input
                    type="password"
                    value={editApiKey}
                    onChange={(e) => setEditApiKey(e.target.value)}
                    onBlur={handleSave}
                    placeholder="Bearer token"
                    style={inputStyle}
                  />
                </div>

                {/* Timeout */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>Timeout (seconds)</label>
                    <input
                      type="number"
                      value={timeoutSec}
                      onChange={(e) => onTimeoutChange(e.target.value)}
                      min="10"
                      max="600"
                      style={{ ...inputStyle, width: 80 }}
                    />
                  </div>
                </div>

                {/* Models section */}
                <div style={{ borderTop: "1px solid #e8e6e0", paddingTop: 16 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 700, color: "#1a1a1a", marginBottom: 8,
                  }}>
                    Models
                  </div>

                  {selectedModels.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                      {selectedModels.map((m) => {
                        const isActive = m === model.trim() && selectedProviderId === (
                          allEntries.find((e) =>
                            e.endpoint.replace(/\/+$/, "") === endpoint.trim().replace(/\/+$/, "")
                          )?.providerId
                        );
                        return (
                          <div
                            key={m}
                            style={{
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              padding: "6px 10px", borderRadius: 6,
                              background: isActive ? "rgba(24, 95, 165, 0.08)" : "#f8f7f5",
                              border: isActive ? "1px solid #185fa5" : "1px solid #e8e6e0",
                            }}
                          >
                            <span
                              onClick={() => {
                                onEndpointChange(selectedEntry.endpoint);
                                onApiKeyChange(editApiKey);
                                onModelChange(m);
                              }}
                              style={{
                                fontSize: 12, cursor: "pointer",
                                fontFamily: "'JetBrains Mono', monospace",
                                color: isActive ? "#185fa5" : "#333",
                                fontWeight: isActive ? 600 : 400,
                              }}
                            >
                              {m}
                            </span>
                            <span
                              onClick={() => onDeleteModel(selectedProviderId, m)}
                              style={{
                                cursor: "pointer", fontSize: 11, color: "#999",
                                padding: "2px 4px", lineHeight: 1,
                              }}
                              title={`Remove ${m}`}
                            >
                              ✕
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: "#999", marginBottom: 12 }}>
                      No models saved for this provider.
                    </div>
                  )}

                  {/* Add model input */}
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="text"
                      value={newModelInput}
                      onChange={(e) => setNewModelInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddModelSubmit(); }}
                      placeholder="e.g. gpt-4o, qwen3.5-27b"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button
                      onClick={handleAddModelSubmit}
                      disabled={!newModelInput.trim()}
                      style={{
                        padding: "8px 16px", borderRadius: 6,
                        border: "none", background: "#1a1a1a", color: "#fff",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                        flexShrink: 0,
                        opacity: !newModelInput.trim() ? 0.4 : 1,
                      }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: "100%", color: "#999", fontSize: 13,
              }}>
                Select a provider from the left
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
