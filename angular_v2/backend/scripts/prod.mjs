import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgrestChildEnv } from './postgrest-connection.ts';

/**
 * Production orchestrator (`npm run prod`). Same lifecycle discipline as
 * `scripts/dev.mjs` — any child dying takes the stack down, shutdown leaves
 * no orphans — but it never falls back to development configuration: `NODE_ENV`
 * is forced to `production` for the thin app and the env file is
 * `backend/.env.production`, which must exist (named error, exit 1, no
 * fallback). It also refuses to boot without build output.
 *
 * PostgREST's `PGRST_DB_URI` is COMPOSED by the same module development uses
 * (`scripts/postgrest-connection.ts`), from `DB_HOST`, `DB_PORT`, `DB_NAME` and
 * `AUTHENTICATOR_PASSWORD`, always naming `pgrst_authenticator` as the login
 * role. There is deliberately no production-specific way to name a different
 * one: that role is a member of exactly the three serving roles, and logging in
 * as anything else is either a dead data layer (`permission denied to set role`)
 * or a silent RLS bypass (the table owner). One mechanism, both orchestrators.
 */

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(backendRoot, '..');
const frontendRoot = join(repositoryRoot, 'frontend');

const productionEnvFile = join(backendRoot, '.env.production');
if (!existsSync(productionEnvFile)) {
  console.error(
    '[prod] backend/.env.production is required but does not exist. ' +
      'Copy backend/.env.production.example to backend/.env.production, fill in real secrets, and retry. ' +
      'There is no development fallback.',
  );
  process.exit(1);
}
process.loadEnvFile(productionEnvFile);

/**
 * Composed and validated before the build-output checks, and before anything is
 * spawned, for the reason `dev.mjs` gives: a missing key found here is one line
 * of output, and the same key missing after `spawn` is a half-started stack
 * whose log points at PostgREST rather than at the configuration.
 */
let postgrestEnv;
try {
  postgrestEnv = postgrestChildEnv(process.env);
} catch (error) {
  console.error(`[prod] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const apiBundle = join(backendRoot, 'dist', 'main.js');
const ssrBundle = join(frontendRoot, 'dist', 'frontend', 'server', 'server.mjs');
if (!existsSync(apiBundle)) {
  console.error('[prod] backend/dist/main.js is missing. Build first: `cd backend && npm run build`.');
  process.exit(1);
}
if (!existsSync(ssrBundle)) {
  console.error('[prod] frontend/dist/frontend/server/server.mjs is missing. Build first: `cd frontend && npm run build`.');
  process.exit(1);
}

const children = new Map();
let shuttingDown = false;

function prefixStream(name, stream) {
  let pending = '';
  stream.on('data', (chunk) => {
    pending += chunk.toString('utf8');
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      process.stdout.write(`[${name}] ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (pending !== '') {
      process.stdout.write(`[${name}] ${pending}\n`);
    }
  });
}

function start(name, command, args, options) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    shell: process.platform === 'win32',
    ...options,
  });
  if (child.stdout !== null) { prefixStream(name, child.stdout); }
  if (child.stderr !== null) { prefixStream(name, child.stderr); }
  child.on('error', (error) => {
    console.error(`[prod] ${name} failed to start: ${error.message}`);
    void shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(
        `[prod] ${name} exited unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'none'}); shutting down the stack.`,
      );
      void shutdown(1);
    }
  });
  children.set(name, child);
  return child;
}

/** Kill a child's whole process group: npm wrappers do not forward signals to their own children. */
function killChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      child.kill('SIGTERM');
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    // The group is already gone; the SIGKILL pass below is the backstop.
  }
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children.values()) {
    killChild(child);
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const alive = [...children.values()].some((child) => child.exitCode === null && child.signalCode === null);
    if (!alive) {
      break;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  for (const child of children.values()) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        if (process.platform === 'win32') {
          child.kill('SIGKILL');
        } else {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch {
        // already gone
      }
    }
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

async function waitFor(url, name, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${name} exited before it was ready (code ${child.exitCode})`);
    }
    try {
      await fetch(url, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
  }
  throw new Error(`${name} did not answer ${url} within 120 s`);
}

start('postgrest', 'postgrest', [join(repositoryRoot, 'postgrest.conf')], {
  cwd: repositoryRoot,
  env: postgrestEnv,
});
start('api', 'npm', ['run', 'start:prod'], { cwd: backendRoot, env: { ...process.env, NODE_ENV: 'production' } });
start('ssr', 'npm', ['run', 'serve:ssr:frontend'], { cwd: frontendRoot, env: { ...process.env } });

try {
  await waitFor('http://127.0.0.1:3001/', 'postgrest', children.get('postgrest'));
  await waitFor('http://127.0.0.1:3000/', 'api', children.get('api'));
  await waitFor('http://127.0.0.1:4000/', 'ssr', children.get('ssr'));
} catch (error) {
  console.error(`[prod] readiness check failed: ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
}

console.log(`
[prod] stack ready:
  [postgrest] http://127.0.0.1:3001
  [api]       http://localhost:3000
  [ssr]       http://localhost:4000
`);
