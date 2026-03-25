import BenchmarkResults from "./BenchmarkResults.jsx";
import BubbleChart from "./BubbleChart.jsx";
import Heatmap from "./Heatmap.jsx";
import QuestionExplorer from "./QuestionExplorer.jsx";
import Tabs from "./Tabs.jsx";

export default function BenchmarkPage() {
  return (
    <Tabs tabs={[
      { label: "Model Heatmap", content: <Heatmap /> },
      { label: "Questions", content: <QuestionExplorer /> },
      { label: "Benchmark Results", content: <BenchmarkResults /> },
      { label: "Cost vs Performance", content: <BubbleChart /> },
    ]} />
  );
}
