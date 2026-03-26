/**
 * Filter benchmarks by model entries.
 * Each entry can be:
 *   - "provider/model-name"           -> matches all variants of that model
 *   - "provider/model-name (variant)" -> matches only the specific variant
 */
export function filterBenchmarks(allBenchmarks, models) {
  if (!models || models.length === 0) return allBenchmarks;

  const exactModels = new Set();
  const modelVariantPairs = [];

  for (const entry of models) {
    const match = entry.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (match) {
      modelVariantPairs.push({ model: match[1].trim(), variant: match[2].trim() });
    } else {
      exactModels.add(entry);
    }
  }

  const filtered = allBenchmarks.filter(b => {
    if (exactModels.has(b.model)) return true;
    return modelVariantPairs.some(
      p => p.model === b.model && p.variant === (b.modelVariant || "")
    );
  });

  // Warn about model IDs that didn't match any benchmark
  const matchedModels = new Set(filtered.map(b => b.model));
  const matchedPairs = filtered.map(b => `${b.model} (${b.modelVariant || ""})`);
  const invalid = [];

  for (const m of exactModels) {
    if (!matchedModels.has(m)) invalid.push(m);
  }
  for (const p of modelVariantPairs) {
    const key = `${p.model} (${p.variant})`;
    if (!matchedPairs.includes(key)) invalid.push(key);
  }

  if (invalid.length > 0) {
    console.warn(
      `[filterBenchmarks] The following model IDs did not match any benchmark:\n` +
      invalid.map(id => `  - ${id}`).join("\n")
    );
  }

  return filtered;
}
