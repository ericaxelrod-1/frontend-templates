import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads `backend/.env` into `process.env` before anything validates the
 * environment. Imported for its side effect by `app.module.ts` and by the test
 * helpers, and by nothing else — one loader, so the application and its tests
 * cannot disagree about which values are in effect.
 *
 * A variable already present in the real environment wins, which is what Node's
 * own `--env-file` does, so `JWT_SECRET=… npm start` overrides the file without
 * an edit. A missing file is not an error here: `loadEnvironment` then reports
 * every key that is absent, which names the actual problem.
 */
const envFile = join(process.cwd(), '.env');

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
