import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reads the environment file for the current mode into `process.env` before
 * anything validates the environment. Imported for its side effect by
 * `app.module.ts`, by the test helpers, and by `migrate`/`seed` — one loader,
 * so the application and its tests cannot disagree about which values are in
 * effect.
 *
 * Mode comes from `NODE_ENV` (lowercased), default `development`. The file is
 * resolved next to `backend/`, never against the process cwd, so the loader
 * behaves the same from any directory:
 *
 *   development  backend/.env, else backend/.env.development, else nothing
 *   test         backend/.env.test, never the development file
 *   production   backend/.env.production — absent, throw, naming the file
 *
 * A variable already present in the real environment wins, which is what Node's
 * own `--env-file` does, so `JWT_SECRET=… npm start` overrides the file without
 * an edit. A missing file is not an error in development or test: a zero-config
 * checkout still boots (or fails cleanly in `loadEnvironment`, which names
 * every absent key). Production is the exception: it must fail loudly.
 */

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const mode = (process.env['NODE_ENV'] ?? 'development').toLowerCase();

function loadIfPresent(fileName: string): boolean {
  const path = join(backendRoot, fileName);
  if (existsSync(path)) {
    process.loadEnvFile(path);
    return true;
  }
  return false;
}

if (mode === 'production') {
  const productionFile = join(backendRoot, '.env.production');
  if (!existsSync(productionFile)) {
    throw new Error(
      `NODE_ENV=production requires backend/.env.production, but it does not exist. ` +
        `Copy backend/.env.production.example to backend/.env.production and fill in real secrets. ` +
        `There is no development fallback: running production with development config is worse than not running.`,
    );
  }
  process.loadEnvFile(productionFile);
} else if (mode === 'test') {
  loadIfPresent('.env.test');
} else if (mode === 'development') {
  if (!loadIfPresent('.env')) {
    loadIfPresent('.env.development');
  }
} else {
  throw new Error(
    `NODE_ENV='${mode}' is not a recognised mode. Expected 'development', 'test', or 'production'.`,
  );
}
