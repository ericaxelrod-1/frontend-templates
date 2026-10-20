import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * THE POSTGREST STARTUP CONTRACT — one deadline, one probe, one failure message.
 *
 * ## WHY THIS FILE EXISTS
 *
 * Five suites in this tree start a real PostgREST process, and every one of them
 * used to wait **30 seconds** for it to bind its port. That number was a bug: a
 * PostgREST binds in about a quarter of a second on an idle machine, so 30
 * seconds is not "a generous timeout" — it is a timeout that only fires when the
 * machine is busy. Under load (a full `verify`, several suites at once, a build
 * running alongside) the child could not bind inside the budget, the launcher
 * gave up, the suite's `beforeAll` threw, and **every test in the file was
 * skipped** — a run that reported "301 passed, 25 skipped" and a failure, with
 * a count that does not add up.
 *
 * The suites were right. The launcher was wrong.
 *
 * ## WHAT IS IN HERE, AND WHY IT IS NOT IN THE LAUNCHERS
 *
 *   - `POSTGREST_STARTUP_TIMEOUT_MS` — the ceiling. It is generous enough for a
 *     loaded box and still below the shortest hook timeout in the tree, so the
 *     failure message is the one the operator sees rather than a bare
 *     "Hook timed out".
 *   - `probePostgrest` — the readiness check. It asks the port for the catalogue
 *     over HTTP instead of *binding* the port to see whether it is busy, because
 *     a probe that binds the port is competing with the child for the very port
 *     it is waiting for.
 *   - `describePostgrestStartupFailure` — the message. It says what the child was
 *     doing: the exit code if it died, the log it captured if it is alive and
 *     silent, and how long the launcher waited.
 *
 * The launchers still differ — one serves the RLS proof's database on a fixed
 * port, the others take their settings as arguments — so each of them keeps its
 * own copy of the *shape*. These three are the parts that must not drift.
 *
 * ## THE MEASUREMENT THE CEILING IS DERIVED FROM
 *
 * On this machine PostgREST 16.4 binds its port in **250–600 ms** (spawn to
 * "API server listening on 127.0.0.1:<port>"), against a database that is
 * answering queries. The 30-second budget was nevertheless observed to be too
 * tight on a loaded machine, five suites deep. The ceiling is therefore 90
 * seconds: three times the deadline that was observed to be too tight, and
 * under the shortest hook timeout in the tree (180 s, in the suites that call a
 * launcher from a `beforeAll`), which is what keeps the message below visible
 * instead of being swallowed by a hook timeout. `rls.spec.ts` gives its own
 * `beforeAll` a larger budget for the same reason: its database rebuild sits in
 * front of the launcher, and the two together must fit inside the hook.
 */

/** The ceiling on how long a launcher waits for its PostgREST child to bind its port. */
export const POSTGREST_STARTUP_TIMEOUT_MS = 90_000;

/** How often the readiness probe is repeated while the launcher waits. */
export const POSTGREST_STARTUP_POLL_MS = 250;

/** How long a single readiness probe waits for the port to answer. */
export const POSTGREST_PROBE_TIMEOUT_MS = 2_000;

/** How many lines of the child's own output the failure message shows. */
export const POSTGREST_LOG_LINES_SHOWN = 40;

/**
 * What the readiness probe found.
 *
 * `ready` is true only for a PostgREST serving its catalogue. `answered` is what
 * the port said, for the failure message: it distinguishes "nothing is
 * listening" from "something is listening and it is broken", which are two
 * different problems and used to produce the same error.
 */
export interface PostgrestProbe {
  readonly ready: boolean;
  readonly answered: string | undefined;
}

/**
 * Ask the port for the catalogue, which is the only way to know that the server
 * answering is a PostgREST and not something else that took the port.
 *
 * **It asks over HTTP rather than binding the port.** The earlier check bound
 * the port and reported EADDRINUSE as "PostgREST is up" — which means the check
 * held the very port the child was trying to bind, several times a second, for
 * the whole wait. A probe that competes with the child for the port is a probe
 * that can make the child fail.
 */
export async function probePostgrest(baseUrl: string): Promise<PostgrestProbe> {
  try {
    const response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(POSTGREST_PROBE_TIMEOUT_MS) });
    if (response.status !== 200) {
      return { ready: false, answered: `the port answered HTTP ${response.status}` };
    }
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'paths' in body) {
      return { ready: true, answered: 'the port answered with the PostgREST catalogue' };
    }
    return {
      ready: false,
      answered: 'the port answered HTTP 200 with a body that is not a PostgREST catalogue',
    };
  } catch {
    return { ready: false, answered: undefined };
  }
}

/**
 * A blocking sleep, from the standard library.
 *
 * `sleep` is a POSIX utility and is not on a Windows PATH, so a
 * `spawnSync('sleep', …)` is a no-op there — a wait loop built on it spins at
 * full speed for its whole deadline instead of waiting. `Atomics.wait` is the
 * same thing without a dependency and without a platform.
 */
export function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Binds the port to find out whether anything holds it.
 *
 * Resolves to `undefined` when the port is FREE — the bind succeeded — and to a
 * description when it is held. The bind is released immediately: this is a
 * question about the port, not a claim on it.
 *
 * **It is a bind and not a connection because a connection would miss a server
 * that is still starting up.** A PostgREST that has not finished booting holds
 * the port without answering on it yet, and a connection-based check calls that
 * "free" — which is exactly how a launcher ends up racing a child for the port
 * it is trying to bind.
 */
export async function probePortHeld(port: number): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(`${String(port)} is held by another process`));
    server.once('listening', () => server.close(() => resolve(undefined)));
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Wait for the port to become free, up to `timeoutMs`.
 *
 * **Why a wait and not an immediate refusal.** A port is held for a moment after
 * the process that owned it exits, and the suite that owned it is usually the
 * one that just finished. Refusing to start because the previous instance has
 * not finished letting go is a false failure with a race in it; waiting a few
 * seconds and starting when the port is genuinely free is the same guarantee
 * (`AGENTS.md` §B8: never start a test server on a port something else may
 * already hold) without the race.
 *
 * Resolves to `undefined` when the port became free, and to a description of
 * the holder when it did not.
 */
export async function waitForPortToBeFree(port: number, timeoutMs: number): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const held = await probePortHeld(port);
    if (held === undefined) {
      return undefined;
    }
    if (Date.now() >= deadline) {
      return held;
    }
    await delay(POSTGREST_STARTUP_POLL_MS);
  }
}

/** What the launcher knows about the child it is waiting for. */
export interface PostgrestChildState {
  /** `null` while the child is running. */
  readonly exitCode: number | null;
  /** The signal that killed the child, if one did. */
  readonly signal: NodeJS.Signals | null;
  /** Everything the child wrote to stdout and stderr. */
  readonly log: string;
  /** Set when the child could not be started at all. */
  readonly spawnError: string | undefined;
}

/** Everything the failure message needs, gathered by the launcher. */
export interface PostgrestStartupFailure {
  readonly port: number;
  /** How long the launcher actually waited. */
  readonly waitedMs: number;
  /** The ceiling it was waiting against. */
  readonly timeoutMs: number;
  readonly child: PostgrestChildState;
  readonly probe: PostgrestProbe;
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

/**
 * The message a launcher throws when its child never started listening.
 *
 * "PostgREST did not start listening" was a dead end: it named neither the
 * child nor the machine, and the reader had nothing to act on. This one answers
 * the three questions that actually decide what to do next:
 *
 *   1. **Did the child die?** Its exit code, and whether it said why.
 *   2. **Is it still running?** Whether it logged anything at all.
 *   3. **What did the port say?** Nothing, or something that is not a
 *      PostgREST.
 *
 * The exit-code hint is measured, not guessed: PostgREST 16.4 exits **3 with no
 * error message of any kind** when it cannot bind its port, so a silent exit 3
 * means the port was not free when the child started.
 */
export function describePostgrestStartupFailure(failure: PostgrestStartupFailure): string {
  const { port, waitedMs, timeoutMs, child, probe } = failure;
  const lines: string[] = [];

  lines.push(
    `PostgREST did not start listening on port ${String(port)} within ${seconds(timeoutMs)} (waited ${seconds(waitedMs)}).`,
  );
  lines.push('');

  if (child.spawnError !== undefined) {
    lines.push(`  child:      COULD NOT START — ${child.spawnError}`);
  } else if (child.exitCode !== null || child.signal !== null) {
    const how =
      child.exitCode !== null
        ? `code ${String(child.exitCode)}`
        : `signal ${child.signal ?? 'unknown'}`;
    lines.push(`  child:      EXITED — ${how}`);
  } else {
    lines.push('  child:      ALIVE — the process is still running');
  }

  lines.push(`  port:       ${probe.answered ?? `nothing is answering on ${String(port)}`}`);
  lines.push(
    `  exit code:  ${child.exitCode === null ? 'none (the process has not exited)' : String(child.exitCode)}`,
  );

  const logLines = child.log.split('\n').filter((line) => line.trim() !== '');
  if (logLines.length === 0) {
    lines.push('  log:        the child wrote nothing at all — it never reached "API server listening"');
  } else {
    // The TAIL, and only the tail. A PostgREST that retries a broken connection
    // writes a line every second, so the whole log of a 90-second wait is tens
    // of thousands of bytes — and a failure message nobody can read is a
    // failure message that says nothing. The last lines are the ones that say
    // what the child was doing when the launcher gave up.
    const shown = logLines.slice(-POSTGREST_LOG_LINES_SHOWN);
    lines.push(
      `  log:        ${String(logLines.length)} line(s), ${String(child.log.length)} bytes captured` +
        (shown.length < logLines.length
          ? ` (the last ${String(shown.length)} are shown)`
          : ''),
    );
    lines.push('  --- child output (tail) ---');
    lines.push(shown.join('\n'));
    lines.push('  --- end child output ---');
  }

  if (child.exitCode === 3) {
    lines.push('');
    lines.push(
      '  PostgREST exits 3 with NO error message when it cannot BIND its port, so the usual cause here is',
      '  that the port was not free when the child started — another instance still holding it.',
    );
  }

  return lines.join('\n');
}

/**
 * Wait until the port serves the catalogue, or until the ceiling is reached.
 *
 * The wait is **adaptive in the sense that matters**: it ends the moment the
 * child is up, and the ceiling is only the point at which the launcher gives
 * up. A slow machine costs the wait, not the suite.
 */
export async function waitForPostgrest(
  baseUrl: string,
  options: {
    readonly timeoutMs: number;
    /** True once the child has exited, so the launcher can stop waiting for a corpse. */
    readonly childGone: () => boolean;
  },
): Promise<{
  readonly ready: boolean;
  readonly probe: PostgrestProbe;
  readonly waitedMs: number;
}> {
  const startedAt = Date.now();
  let probe = await probePostgrest(baseUrl);
  let childGone = options.childGone();
  while (!probe.ready && !childGone) {
    if (Date.now() - startedAt >= options.timeoutMs) {
      break;
    }
    await delay(POSTGREST_STARTUP_POLL_MS);
    probe = await probePostgrest(baseUrl);
    childGone = options.childGone();
  }
  return { ready: probe.ready, probe, waitedMs: Date.now() - startedAt };
}
