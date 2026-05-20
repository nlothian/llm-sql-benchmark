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
