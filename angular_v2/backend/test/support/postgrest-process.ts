import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * The PostgREST binary, RESOLVED rather than hard-coded.
 *
 * The suites that need the real API layer run on more than one machine, and the
 * install path is not the same everywhere: the Linux proofs keep it at
 * `/usr/local/bin/postgrest`, and a Windows install puts it somewhere else
 * entirely. The hard-coded path made this launcher report "not installed" on a
 * machine where it plainly was, so the suite that needed it could not run at all
 * — and the failure named the wrong thing.
 *
 * `PGRST_BINARY` wins when it is set, then the POSIX path, then the first
 * `postgrest` on `PATH`. A name that is not found is an error, never a guess.
 */
function resolvePostgrestBinary(): string {
  const configured = process.env['PGRST_BINARY'];
  if (configured !== undefined && configured !== '') {
    if (!existsSync(configured)) {
      throw new Error(`PGRST_BINARY names ${configured}, which does not exist on this machine`);
    }
    return configured;
  }

  const posixPath = '/usr/local/bin/postgrest';
  if (existsSync(posixPath)) {
    return posixPath;
  }

  const pathVariable = process.env['PATH'] ?? '';
  for (const directory of pathVariable.split(delimiter)) {
    if (directory === '') {
      continue;
    }
    // Windows resolves a bare name to the `.exe` beside it; the extension is
    // added here rather than left to `spawn`, because the guard below has to
    // know whether the binary is there at all.
    for (const name of process.platform === 'win32' ? ['postgrest.exe', 'postgrest'] : ['postgrest']) {
      const candidate = join(directory, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    'PostgREST is not installed: it is not at /usr/local/bin/postgrest, it is not named by PGRST_BINARY, ' +
      'and it is not on PATH. A suite that needs the real API layer cannot run without it, and asserting ' +
      'against a stand-in would be testing a mock (AGENTS.md §2.2).',
  );
}

/** What `startPostgrestProcess` returns, and what `stop` is for. */
export interface PostgrestProcess {
  /** The origin the thin app should be pointed at, e.g. `http://127.0.0.1:3016`. */
  readonly baseUrl: string;
  /** Everything the child wrote to stderr, so a failure is debuggable rather than silent. */
  readonly log: () => string;
  /** Terminate and wait for the port to actually free. */
  readonly stop: () => void;
}

/** Anything already answering on `port`, or `undefined` when the port is free. */
async function probePort(port: number): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(`${String(port)} is in use`));
    server.once('listening', () => server.close(() => resolve(undefined)));
    server.listen(port, '127.0.0.1');
  });
}

/**
 * A blocking sleep, from the standard library.
 *
 * `sleep` is a POSIX utility and is not on a Windows PATH, so the previous
 * `spawnSync('sleep', …)` was a no-op there — the wait loop spun at full speed
 * for its whole deadline instead of waiting. `Atomics.wait` is the same thing
 * without a dependency and without a platform.
 */
function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export interface PostgrestProcessOptions {
  readonly port: number;
  readonly database: string;
  readonly authenticatorPassword: string;
  /** Must be the SAME secret the application mints with, or every request is PGRST301. */
  readonly jwtSecret: string;
}

/**
 * Start a real PostgREST against a throwaway database, for a suite that needs the API
 * layer rather than just the database.
 *
 * ## WHY THIS EXISTS AND WHY IT IS NOT A SECOND COPY OF THE RLS FIXTURE'S
 *
 * `GET /api/users/me` is the one route in the thin app that reaches PostgREST: it is
 * read through the identity seam so the caller's OWN role and column grant decide what
 * comes back (`src/users/users.service.ts` §Two ways in). A test that asserted that
 * route without a real PostgREST would be asserting against a stand-in for the API
 * layer — which is §2.2, and §B8's "mocks hide schema and policy bugs" in its purest
 * form: the whole point of the route is that PostgreSQL decides the answer.
 *
 * `test/rls/support/fixture.ts` already starts PostgREST, but its `startPostgrest` is
 * hard-wired to the RLS proof's own database and port (3016) and to the proof's own
 * signing secret, and it is imported by five suites that assert on that exact
 * configuration. Parameterising it would mean touching the RLS proof's shared fixture,
 * and the brief for this unit is to add to `src/` and the suites, not to refactor a
 * security proof nobody can re-run here. So this is a second launcher, and the honest
 * description of it is: **one copy per configuration, not per call site** — the RLS
 * fixture's is proof-specific and this one is suite-specific, and if a third
 * configuration ever needs one, the right move is to lift both into this module.
 *
 * ## WHY THE PORT GUARD IS NOT OPTIONAL
 *
 * Without it the readiness probe below succeeds against somebody else's server — a
 * leftover instance from a previous run, or a developer's own PostgREST on 3001 — and
 * the suite silently tests a database it did not create. Every assertion then either
 * passes against the wrong schema or fails for a reason that points nowhere, and the
 * log says "listening" either way. `AGENTS.md` §B8: "Never start a test server on a
 * port something else may already hold."
 *
 * ## WHY EVERY INHERITED `PGRST_*` IS DELETED RATHER THAN OVERWRITTEN
 *
 * `test/support/database.ts` imports the `.env` loader, so `PGRST_JWT_SECRET` from
 * `backend/.env` is in the parent environment — and PostgREST gives environment
 * variables precedence over its config file. The child would then verify tokens
 * against the developer's application secret while the suite mints them with its own,
 * and every request would fail at authentication with PGRST301 before reaching a
 * single policy. The keys are DELETED rather than set to `undefined`, because `spawn`
 * stringifies env values and `undefined` would reach PostgREST as the literal text
 * `"undefined"` — a new silent misconfiguration in place of the old one.
 */
export async function startPostgrestProcess(options: PostgrestProcessOptions): Promise<PostgrestProcess> {
  const { port, database, authenticatorPassword, jwtSecret } = options;

  const binary = resolvePostgrestBinary();

  const contention = await probePort(port);
  if (contention !== undefined) {
    throw new Error(
      `port ${String(port)} is already serving (${contention}). This suite starts its own PostgREST and must ` +
        'not attach to another one, or every assertion below would be about a database it did not create.',
    );
  }

  const directory = mkdtempSync(join(tmpdir(), 'profile-e2e-pgrst-'));
  const config = join(directory, 'postgrest.conf');
  writeFileSync(
    config,
    [
      `db-uri = "postgresql://pgrst_authenticator:${authenticatorPassword}@localhost:5432/${database}"`,
      'db-schemas = "public"',
      'db-anon-role = "app_anon"',
      `jwt-secret = "${jwtSecret}"`,
      // The leading dot is the whole fix: AGENTS.md §B5 records that the bare claim
      // name makes PostgREST 16.4 PANIC on boot rather than fall back, and that `$.role`
      // panics too. Do not "modernise" this line.
      'jwt-role-claim-key = ".role"',
      'server-host = "127.0.0.1"',
      `server-port = ${String(port)}`,
      'db-channel-enabled = true',
      // `ignore-privileges` advertises every relation in db-schemas regardless of grants,
      // which is why a member grant on `login_attempts` would make the relation a live
      // enumeration endpoint rather than a merely documented one. See
      // `UsersService.loginAttempts`.
      'openapi-mode = "ignore-privileges"',
      '',
    ].join('\n'),
    'utf8',
  );

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('PGRST_')) {
      delete env[key];
    }
  }
  const child: ChildProcess = spawn(binary, [config], {
    env: {
      ...env,
      PGRST_DB_URI: `postgresql://pgrst_authenticator:${authenticatorPassword}@localhost:5432/${database}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    log += chunk.toString('utf8');
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    log += chunk.toString('utf8');
  });

  let owned = false;
  const stop = (): void => {
    if (owned && child.exitCode === null) {
      child.kill('SIGTERM');
      // Wait for the port to actually free. `kill` returns immediately and the child
      // holds the socket for a few hundred ms, so a suite killed mid-run leaves an
      // orphan whose next run fails the port guard above with nothing naming it.
      const deadline = Date.now() + 5_000;
      while (child.exitCode === null && Date.now() < deadline) {
        sleepSync(100);
      }
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        sleepSync(200);
      }
    }
    rmSync(directory, { recursive: true, force: true });
  };

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`PostgREST exited before it was ready (code ${String(child.exitCode)}):\n${log}`);
    }
    // `probePort` resolves a STRING when the port is IN USE and `undefined` when it is
    // FREE — it binds the port itself and reports EADDRINUSE as the signal. So the
    // readiness condition is the port being BUSY, which is our own PostgREST answering.
    //
    // This was inverted (`=== undefined`), so the loop returned on the FIRST tick while
    // the port was still free — before PostgREST had bound it. Every caller then raced a
    // server that did not exist yet, and the race surfaced as an intermittent
    // `connection refused` rather than as a failed assertion. `member-self-write.spec.ts`
    // grew its own guard to route around it, which is what made the inversion survive:
    // the one suite that noticed it worked around it instead of reporting it.
    //
    // It is safe to treat "busy" as "ready" because the contention guard above already
    // refused to start if anything was serving on this port BEFORE the spawn. The only
    // thing that can occupy it since is the child this function started.
    const serving = await probePort(port);
    if (serving !== undefined) {
      owned = true;
      return {
        baseUrl: `http://127.0.0.1:${String(port)}`,
        log: () => log,
        stop,
      };
    }
    sleepSync(200);
  }

  stop();
  throw new Error(`PostgREST did not start listening on ${String(port)} within 30s:\n${log}`);
}