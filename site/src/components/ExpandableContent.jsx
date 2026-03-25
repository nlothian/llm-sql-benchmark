import { useState, useRef, useEffect } from "react";

export default function ExpandableContent({ children, maxWidth = 500, caption = "Click to expand" }) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef(null);
  const lightboxRef = useRef(null);

  useEffect(() => {
    if (expanded && contentRef.current && lightboxRef.current) {
      const svg = contentRef.current.querySelector("svg");
      if (svg) {
        const clone = svg.cloneNode(true);
        clone.removeAttribute("width");
        clone.style.width = "100%";
        clone.style.maxWidth = "none";
        clone.style.height = "auto";
        lightboxRef.current.innerHTML = "";
        lightboxRef.current.appendChild(clone);
      }
    }
  }, [expanded]);

  return (
    <>
      <div
        ref={contentRef}
        onClick={() => setExpanded(true)}
        style={{
          maxWidth,
          margin: "0 auto",
          cursor: "zoom-in",
          position: "relative",
        }}
      >
        {children}
        <div
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "var(--distill-muted-soft, #888)",
            marginTop: 4,
          }}
        >
          {caption}
        </div>
      </div>

      {expanded && (
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
            padding: 32,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            ref={lightboxRef}
            style={{
              background: "var(--distill-bg, #fff)",
              borderRadius: 8,
              padding: 24,
              maxWidth: "90vw",
              maxHeight: "90vh",
              overflow: "auto",
            }}
          />
        </div>
      )}
    </>
  );
}
