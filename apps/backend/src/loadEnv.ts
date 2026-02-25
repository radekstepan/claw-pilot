/**
 * Side-effect-only module: loads the root .env file into process.env.
 *
 * This MUST be the first import in index.ts. ESM evaluates static imports
 * depth-first before any module body code runs, so importing this module
 * before config/env.ts guarantees dotenv populates process.env before Zod
 * validates it — which is what the inline `loadEnv()` call in the old
 * index.ts body failed to do (the body ran after env.ts was already parsed).
 *
 * Works from both src/ (tsx dev) and dist/ (node production) — both sit
 * exactly 3 levels below the monorepo root.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '../../../.env') });
