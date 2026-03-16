import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DATA_DIR = join(ROOT, 'packages', 'data-adventureworks');
const QUESTIONS_JSON = join(DATA_DIR, 'questions.json');
const OUTPUT_TS = join(DATA_DIR, 'src', 'generated', 'manifest.ts');

if (!existsSync(QUESTIONS_JSON)) {
  console.error(`Missing benchmark dataset source: ${QUESTIONS_JSON}`);
  process.exit(1);
}

const raw = readFileSync(QUESTIONS_JSON, 'utf-8');
const parsed = JSON.parse(raw);

const questions = parsed.questions ?? parsed;
const categories = parsed.categories ?? {};
const registerTables = parsed.registertables ?? [];
const tableFiles = registerTables
  .map((sql) => sql.match(/read_csv_auto\('([^']+)'\)/))
  .filter(Boolean)
  .map((match) => match[1]);

const tableUrlEntries = tableFiles
  .map((tableFile) => {
    const assetPath = tableFile.replace(/^tables\//, 'tables/');
    return `  ${JSON.stringify(tableFile)}: new URL(${JSON.stringify(`../../assets/${assetPath}`)}, import.meta.url)`;
  })
  .join(',\n');

for (const tableFile of tableFiles) {
  const tablePath = join(DATA_DIR, 'assets', tableFile);
  if (!existsSync(tablePath)) {
    console.error(`Missing benchmark table asset: ${tablePath}`);
    process.exit(1);
  }
}

const content = `// Auto-generated - do not edit. Run \`npm run bundle-benchmark\` to regenerate.

export const BENCHMARK_CATEGORIES = ${JSON.stringify(categories, null, 2)} as const;

export const BENCHMARK_REGISTER_TABLES: string[] = ${JSON.stringify(registerTables, null, 2)};

export const BENCHMARK_TABLE_FILES: string[] = ${JSON.stringify(tableFiles, null, 2)};

export const BENCHMARK_TABLE_URLS: Record<string, URL> = {
${tableUrlEntries}
};

export const BENCHMARK_QUESTIONS = ${JSON.stringify(questions, null, 2)} as const;
`;

mkdirSync(join(DATA_DIR, 'src', 'generated'), { recursive: true });
writeFileSync(OUTPUT_TS, content, 'utf-8');
console.log(`Wrote ${OUTPUT_TS} (${questions.length} questions)`);
