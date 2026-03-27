import mermaid from "mermaid";

const diagrams = document.querySelectorAll<HTMLElement>("pre.mermaid");
if (diagrams.length) {
  mermaid.initialize({ startOnLoad: false });
  mermaid.run({ nodes: Array.from(diagrams) });
}
