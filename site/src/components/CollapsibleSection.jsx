import { useState } from "react";

export default function CollapsibleSection({ title, children, defaultOpen = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          userSelect: "none",
          padding: "10px 16px",
          background: "rgba(28, 130, 173, 0.06)",
          borderRadius: 6,
          border: "1px solid var(--distill-rule)",
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 600, color: "var(--distill-text)" }}>
          {title}
        </span>
        <span
          style={{
            fontSize: 22,
            color: "var(--distill-muted-soft)",
            transition: "transform 0.2s ease",
            transform: isOpen ? "rotate(90deg)" : "rotate(180deg)",
            display: "inline-block",
          }}
        >
          &#x25B8;
        </span>
      </div>
      <div style={{ display: isOpen ? "block" : "none" }}>{children}</div>
    </div>
  );
}
