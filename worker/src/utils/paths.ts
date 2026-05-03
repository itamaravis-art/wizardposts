// App-wide absolute paths; ensures required directories exist on import.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// src/utils/paths.ts -> worker root is two levels up
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const SESSION_DIR = path.join(DATA_DIR, 'session');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const TEMP_DIR = path.join(DATA_DIR, 'temp');
export const SCREENSHOTS_DIR = path.join(DATA_DIR, 'screenshots');

for (const dir of [DATA_DIR, SESSION_DIR, LOGS_DIR, TEMP_DIR, SCREENSHOTS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
