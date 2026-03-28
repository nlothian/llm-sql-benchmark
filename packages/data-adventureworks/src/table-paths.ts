import { BENCHMARK_TABLE_FILES } from './generated/manifest';
import { BENCHMARK_TABLE_URLS } from './generated/table-urls';

const KNOWN_TABLE_FILES = new Set(BENCHMARK_TABLE_FILES);

function normalizeTableFile(name: string): string {
  const trimmed = name.trim().replace(/^\.?\//, '');
  if (trimmed.startsWith('tables/')) {
    return trimmed;
  }
  return `tables/${trimmed}`;
}

function assertTableExists(normalizedPath: string): void {
  if (!KNOWN_TABLE_FILES.has(normalizedPath)) {
    throw new Error(`Unknown benchmark table: ${normalizedPath}`);
  }
}

export function getBrowserTableUrl(name: string): string {
  const normalized = normalizeTableFile(name);
  assertTableExists(normalized);
  return BENCHMARK_TABLE_URLS[normalized].toString();
}

export function getNodeTablePath(name: string): string {
  const normalized = normalizeTableFile(name);
  assertTableExists(normalized);
  const url = BENCHMARK_TABLE_URLS[normalized];
  if (url.protocol !== 'file:') {
    throw new Error(`Expected file URL for ${normalized}, got ${url.protocol}`);
  }
  return decodeURIComponent(url.pathname);
}

export { BENCHMARK_TABLE_URLS };
