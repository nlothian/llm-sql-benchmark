import { useState } from "react";

export default function Tabs({ tabs, defaultIndex = 0 }) {
  const [active, setActive] = useState(defaultIndex);

  return (
    <div style={{ fontFamily: "'Geist', 'SF Pro Display', -apple-system, sans-serif" }}>
      <div style={{
        display: "flex", gap: 2, borderBottom: "2px solid #e8e6e0",
        marginBottom: 0, padding: "0 16px",
      }}>
        {tabs.map((tab, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            style={{
              fontSize: 13, fontWeight: 600, padding: "10px 20px",
              border: "none", borderBottom: active === i ? "2px solid #1a1a1a" : "2px solid transparent",
              marginBottom: -2,
              background: "transparent",
              color: active === i ? "#1a1a1a" : "#999",
              cursor: "pointer",
              transition: "all 0.15s ease",
              letterSpacing: 0.2,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div>{tabs[active]?.content}</div>
    </div>
  );
}
