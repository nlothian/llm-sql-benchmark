import { execFileSync } from 'child_process';
import { join } from 'path';

const script = join(import.meta.dirname, 'generate-benchmark-data.mjs');
execFileSync('node', [script], { stdio: 'inherit' });
