import { useEffect, useState } from "react";
import BenchmarkResults from "./BenchmarkResults.jsx";
import BubbleChart from "./BubbleChart.jsx";
import Heatmap from "./Heatmap.jsx";
import QuestionExplorer from "./QuestionExplorer.jsx";
import Tabs from "./Tabs.jsx";

export default function BenchmarkPage() {
  const [highlightId, setHighlightId] = useState(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const param = new URLSearchParams(window.location.search).get("highlight");
    if (!param) return;
    setHighlightId(param);

    // The page grows taller as Mermaid/images/charts load below, so a single
    // scrollIntoView fires against a stale layout. Re-scroll a few times
    // during initial load, and again on window `load`.
    const scrollToAnchor = () => {
      document.getElementById("all-data")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    const timers = [50, 400, 1000, 2000].map(ms => setTimeout(scrollToAnchor, ms));
    window.addEventListener("load", scrollToAnchor, { once: true });
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("load", scrollToAnchor);
    };
  }, []);

  return (
    <Tabs tabs={[
      { label: "Model Heatmap", content: <Heatmap highlightId={highlightId} /> },
      { label: "Questions", content: <QuestionExplorer /> },
      { label: "Benchmark Results", content: <BenchmarkResults /> },
      { label: "Cost vs Performance", content: <BubbleChart highlightId={highlightId} /> },
    ]} />
  );
}
