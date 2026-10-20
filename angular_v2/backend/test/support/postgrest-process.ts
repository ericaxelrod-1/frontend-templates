import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  describePostgrestStartupFailure,
  POSTGREST_STARTUP_TIMEOUT_MS,
  sleepSync,
  waitForPortToBeFree,
  waitForPostgrest,
  type PostgrestChildState,
} from './postgrest-startup.js';

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
  /** Everything the child wrote to stdout and stderr, so a failure is debuggable rather than silent. */
  readonly log: () => string;
  /** Terminate and wait for the port to actually free. */
  readonly stop: () => void;
}

/**
 * How long the launcher waits for the port to become free before it refuses to
 * start.
 *
 * Long enough for the instance that owned the port a moment ago to let go of
 * it, short enough that a genuine conflict is reported rather than waited on.
 */
const PORT_GUARD_TIMEOUT_MS = 10_000;

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
 *
 * ## THE DEADLINE, AND WHY IT IS NOT 30 SECONDS
 *
 * The wait used to be 30 seconds, and that was the bug: a PostgREST binds its port in
 * about a quarter of a second, so 30 seconds is not patience, it is a deadline that
 * only fires when the machine is busy. Under load the child could not bind inside it,
 * the launcher gave up, the suite's `beforeAll` threw, and every test in the file was
 * **skipped** — a run that reported a failure and a count that does not add up.
 *
 * The deadline, the readiness probe and the failure message now live in
 * `test/support/postgrest-startup.ts`, because five launchers in this tree were
 * carrying five copies of the same 30 seconds. See that file for the measurement the
 * new ceiling is derived from.
 */
export async function startPostgrestProcess(options: PostgrestProcessOptions): Promise<PostgrestProcess> {
  const { port, database, authenticatorPassword, jwtSecret } = options;

  const binary = resolvePostgrestBinary();

  // The port guard. It WAITS for the port rather than refusing on the first
  // look, because the instance that owned it a moment ago is usually the
  // previous suite's, and it lets go a moment after it exits. A bind — not a
  // connection — is the question, because a server that is still starting up
  // holds the port without answering on it yet, and a connection-based check
  // would call that "free" and hand the child a port it cannot bind.
  const contention = await waitForPortToBeFree(port, PORT_GUARD_TIMEOUT_MS);
  if (contention !== undefined) {
    throw new Error(
      `port ${String(port)} is already held (${contention}) and did not become free within ${String(PORT_GUARD_TIMEOUT_MS)}ms. ` +
        'This suite starts its own PostgREST and must not attach to another one, or every assertion below would be ' +
        'about a database it did not create.',
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

  // A child that could not be started at all raises an `error` event, and an
  // unhandled one takes the whole test run down with an exception that names
  // neither the binary nor the port. It is captured here instead, and it reaches
  // the failure message.
  let spawnError: string | undefined;
  child.on('error', (error: Error) => {
    spawnError = error.message;
    log += `\n[the child could not be started: ${error.message}]\n`;
  });

  const stop = (): void => {
    // The child is OURS, whether or not it ever became ready: the old guard
    // (`owned && …`) let a child that failed to start stay alive, and an
    // orphaned PostgREST holds the port and the database connection for the
    // next run — which then fails the port guard with nothing naming it.
    if (child.exitCode === null) {
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

  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const outcome = await waitForPostgrest(baseUrl, {
    timeoutMs: POSTGREST_STARTUP_TIMEOUT_MS,
    childGone: () => child.exitCode !== null || spawnError !== undefined,
  });

  if (outcome.ready) {
    return {
      baseUrl,
      log: () => log,
      stop,
    };
  }

  // The child is killed BEFORE the error is thrown, so a failed launch leaves
  // no orphan holding the port.
  stop();

  const childState: PostgrestChildState = {
    exitCode: child.exitCode,
    signal: child.signalCode,
    log,
    spawnError,
  };
  throw new Error(
    describePostgrestStartupFailure({
      port,
      waitedMs: outcome.waitedMs,
      timeoutMs: POSTGREST_STARTUP_TIMEOUT_MS,
      child: childState,
      probe: outcome.probe,
    }),
  );
}