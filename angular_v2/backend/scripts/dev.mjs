import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgrestChildEnv } from './postgrest-connection.ts';
import { SMTP_SINK_LOOPBACK_ADDRESS, startSmtpSink } from './smtp-sink.ts';
import { parseSmtpMessage } from './smtp-message.ts';

/**
 * Development orchestrator (`npm run dev`). Boots the three processes the app
 * is made of — PostgREST (:3001), the thin Nest app (:3000), and the Angular
 * SSR server (:4000) — and drives them as one lifecycle: any child dying
 * takes the stack down, and shutdown (Ctrl+C, SIGTERM, a child crash) leaves
 * no orphans.
 *
 * **The local SMTP sink is not a fourth process.** It is hosted here, in this
 * process, by `startSmtpSink` from `scripts/smtp-sink.ts` — the same
 * implementation the e2e suite imports, so the repository has one sink rather
 * than a development one and a test one that drift. The application has exactly
 * one mail transport, so development and production run the same code and differ
 * only in the destination; development's destination is this listener, on the
 * loopback address, on the port `EMAIL_PORT` names. It relays nothing — it
 * stores what it accepts so a developer can read a verification link out of it,
 * which is exactly why `environment.ts` refuses a loopback `EMAIL_HOST` in
 * production: SMTP's `250` is an acknowledgement, not a delivery.
 *
 * The env file is resolved with the same rules as
 * `backend/src/config/load-env-file.ts` — development mode: `backend/.env`,
 * else `backend/.env.development` — because PostgREST needs its database URI and
 * PGRST_JWT_SECRET in its own process env before any child can boot. That
 * loader is the authority for the thin app; this mirrors it for the
 * orchestrator itself.
 *
 * **PostgREST's `PGRST_DB_URI` is composed, not configured.** `scripts/postgrest-connection.ts`
 * builds it from `DB_HOST`, `DB_PORT`, `DB_NAME` and `AUTHENTICATOR_PASSWORD`, always
 * naming `pgrst_authenticator` as the login role. It is NOT read from the env file,
 * because the value that used to ship there — `postgresql://app:app@…`, the
 * migration/owner role — owns every table (so it bypasses its own RLS, silently)
 * and is a member of none of the three serving roles (so every `SET ROLE` from a
 * token is refused with `42501 permission denied to set role "app_anon"`). `GET /`
 * still answers 200 in that state, which is why the broken data layer went
 * unnoticed. See that module for the rest of the argument; this paragraph is only
 * so the next reader knows the absence is deliberate and not an oversight.
 */

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(backendRoot, '..');
const frontendRoot = join(repositoryRoot, 'frontend');

const mode = (process.env['NODE_ENV'] ?? 'development').toLowerCase();

if (mode !== 'development') {
  console.error(`[dev] refusing to boot: NODE_ENV='${mode}'. npm run dev is the development stack; use npm run prod for production.`);
  process.exit(1);
}

for (const name of ['.env', '.env.development']) {
  const path = join(backendRoot, name);
  if (existsSync(path)) {
    process.loadEnvFile(path);
    break;
  }
}

/**
 * PostgREST's whole environment, validated and composed BEFORE anything is
 * spawned.
 *
 * Every failure this can raise is a configuration failure, and a configuration
 * failure found here costs one line of output; the same failure found after
 * `spawn` costs a half-started stack and a log line pointing at PostgREST rather
 * than at the key that is missing. So the composition runs first, and its error
 * is printed verbatim — it names every absent key, so one edit fixes all of them.
 */
let postgrestEnv;
try {
  postgrestEnv = postgrestChildEnv(process.env);
} catch (error) {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const ssrBundle = join(frontendRoot, 'dist', 'frontend', 'server', 'server.mjs');

/**
 * The sink's port is whatever the loaded environment says, because that is the
 * same key the thin app reads to build its transport. It is validated here as a
 * number rather than defaulted: a `EMAIL_PORT` the app would reject has to be
 * rejected before a child is spawned, not after.
 */
const sinkPort = Number.parseInt(process.env['EMAIL_PORT'] ?? '', 10);
if (!Number.isInteger(sinkPort) || sinkPort < 1 || sinkPort > 65535) {
  console.error(
    `[dev] EMAIL_PORT is not a port number (${JSON.stringify(process.env['EMAIL_PORT'] ?? null)}). ` +
      'It is required in every mode: the application has one mail transport and needs a destination. ' +
      'Set EMAIL_PORT=1025 for the local sink (see backend/.env.example).',
  );
  process.exit(1);
}

/**
 * The sink is in this process, so a failure to start it is a failure of this
 * command and nothing else has been spawned yet.
 */
const sink = await startSmtpSink({ port: sinkPort });
console.log(`[dev] local SMTP sink listening on ${sink.host}:${sink.port} (accepts and stores; relays nothing)`);

/**
 * Printing an accepted message is the sink's whole purpose in development: it is
 * how a zero-credential checkout reads a verification link, which is what the
 * deleted stream transport used to do by logging the rendered MIME. It is
 * development-only, on a loopback listener, in the terminal of whoever asked
 * for the message — and nothing under `src/` can start a sink, so there is no
 * configuration that puts a token in a production log through this path.
 *
 * Each message is reported once, as the link a recipient would actually click:
 * the plain-text part, decoded, rather than a header dump of quoted-printable.
 */
let reportedDeliveries = 0;

function reportSinks() {
  while (reportedDeliveries < sink.deliveries.length) {
    const delivery = sink.deliveries[reportedDeliveries];
    reportedDeliveries += 1;
    if (delivery === undefined) {
      continue;
    }
    const message = parseSmtpMessage(delivery.raw);
    process.stdout.write(
      `\n[smtp-sink] ${delivery.secure ? 'TLS ' : ''}${delivery.openingCommand} ` +
        `from ${delivery.mailFrom ?? '<>'} to ${delivery.recipients.join(', ')}` +
        `${delivery.authenticatedAs === null ? '' : ` (auth ${delivery.authenticatedAs})`}\n` +
        `  Subject: ${message.headers['subject'] ?? '(none)'}\n` +
        `${message.text
          .split(/\r?\n/)
          .map((line) => `  | ${line}`)
          .join('\n')}\n`,
    );
  }
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
    console.error(`[dev] ${name} failed to start: ${error.message}`);
    void shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[dev] ${name} exited unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'none'}); shutting down the stack.`);
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
  // The sink lives in this process, so it goes down with it. Explicit rather
  // than implicit: a listener left open would hold the port and make the next
  // `npm run dev` refuse to start.
  await sink.close();
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

/**
 * A TCP connect, because a mail sink answers SMTP and nothing else — `fetch` on
 * it would be a protocol error dressed up as a readiness check.
 */
function waitForTcp(port, name) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = createConnection({ host: SMTP_SINK_LOOPBACK_ADDRESS, port });
    const settle = (fn) => {
      socket.destroy();
      fn();
    };
    socket.once('connect', () => settle(resolvePromise));
    socket.once('error', (error) =>
      settle(() => rejectPromise(new Error(`${name} did not accept a connection on ${SMTP_SINK_LOOPBACK_ADDRESS}:${port}: ${error.message}`))),
    );
  });
}

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

/** One-time SSR prerequisite: a fresh checkout has no bundle, so build it once here. */
if (!existsSync(ssrBundle)) {
  console.log('[dev] frontend/dist/frontend/server/server.mjs is missing — running the one-time `npm run build` in frontend/ (takes a minute).');
  const build = spawn('npm', ['run', 'build'], { cwd: frontendRoot, stdio: 'inherit', shell: process.platform === 'win32' });
  const code = await new Promise((resolvePromise) => build.on('exit', resolvePromise));
  if (code !== 0 || !existsSync(ssrBundle)) {
    console.error('[dev] the frontend build failed. Fix it above, or run `npm run build` in frontend/ yourself, then retry.');
    process.exit(1);
  }
}

start('postgrest', 'postgrest', [join(repositoryRoot, 'postgrest.conf')], {
  cwd: repositoryRoot,
  env: postgrestEnv,
});
start('api', 'npm', ['run', 'start:dev'], { cwd: backendRoot, env: { ...process.env, NODE_ENV: 'development' } });
start('ssr', 'npm', ['run', 'serve:ssr:frontend'], { cwd: frontendRoot, env: { ...process.env, PORT: '4000' } });

try {
  await waitForTcp(sink.port, 'the local SMTP sink');
  await waitFor('http://127.0.0.1:3001/', 'postgrest', children.get('postgrest'));
  await waitFor('http://127.0.0.1:3000/', 'api', children.get('api'));
  await waitFor('http://127.0.0.1:4000/', 'ssr', children.get('ssr'));
} catch (error) {
  console.error(`[dev] readiness check failed: ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
}

// The sink's own capture, reported on a timer so a link a developer triggers
// from another terminal shows up here without them asking for it.
const sinkReport = setInterval(reportSinks, 1_000);
sinkReport.unref();

console.log(`
[dev] stack ready:
  [postgrest] http://127.0.0.1:3001
  [api]       http://localhost:3000
  [ssr]       http://localhost:4000
  [smtp-sink] ${sink.host}:${sink.port} (relay is not a real relay — this listener stores and never sends onward)
`);
