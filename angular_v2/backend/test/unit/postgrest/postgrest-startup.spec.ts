import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  describePostgrestStartupFailure,
  POSTGREST_STARTUP_TIMEOUT_MS,
  probePostgrest,
  type PostgrestChildState,
} from '../../support/postgrest-startup.js';

/**
 * THE STARTUP DEADLINE AND THE FAILURE MESSAGE.
 *
 * A PostgREST that is slow to bind its port used to end a suite: the launcher
 * gave up after 30 seconds, the suite's `beforeAll` threw, and every test in
 * the file was **skipped** — a run that reported a failure and a count that did
 * not add up. The suites were right; the launcher was wrong.
 *
 * Reproducing the condition is awkward, so this asserts the two things that
 * make it harmless instead:
 *
 *   1. the deadline is generous enough for a loaded machine, and still short
 *      enough that the launcher's own message is what the operator sees;
 *   2. the message says what the child was doing — dead with a code, alive and
 *      silent, or never started at all.
 */

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

/** A server that answers `GET /` with the body it is given. */
async function serveOn(port: number, body: string, status = 200): Promise<string> {
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${String(port)}`;
}

describe('the PostgREST startup deadline', () => {
  it('is generous enough for a loaded machine', () => {
    // **Why three times.** The deadline that was observed to be too tight was
    // 30 seconds, and it was observed on five suites under load — a full
    // `verify`, several suites at once, a build running alongside. A ceiling
    // below the deadline that is known to fail is a ceiling that will fail
    // again. 90 seconds is three times the observed-too-tight budget, and a
    // PostgREST that binds its port in a quarter of a second on an idle
    // machine has three minutes of slack to do it on a busy one.
    expect(POSTGREST_STARTUP_TIMEOUT_MS).toBeGreaterThanOrEqual(3 * 30_000);
  });

  it('is below the shortest hook timeout that calls a launcher, so its message is the one that surfaces', () => {
    // Every suite that starts a PostgREST calls it from a `beforeAll`, and the
    // shortest of those hooks waits 180 seconds. A ceiling above that would let
    // the HOOK time out first, and the operator would get "Hook timed out" and
    // none of the launcher's diagnostics — the exact dead end this replaced.
    expect(POSTGREST_STARTUP_TIMEOUT_MS).toBeLessThan(180_000);
  });
});

describe('the readiness probe', () => {
  it('calls a port nothing is serving on NOT ready', async () => {
    // The inversion this replaces was real: the old probe reported "the port is
    // free" by BINDING it, and the launcher then raced a server that did not
    // exist yet. The probe asks the port instead, and a port with nothing on it
    // is not ready.
    const probe = await probePostgrest('http://127.0.0.1:3199');

    expect(probe.ready).toBe(false);
    expect(probe.answered).toBeUndefined();
  });

  it('calls a port serving the PostgREST catalogue ready', async () => {
    const baseUrl = await serveOn(3198, JSON.stringify({ openapi: '3.0.3', paths: { '/projects': {} } }));

    const probe = await probePostgrest(baseUrl);

    expect(probe.ready).toBe(true);
  });

  it('calls a port serving something that is not a catalogue NOT ready', async () => {
    // The probe is what makes "something else took the port" visible, instead of
    // a suite that silently tests a database it did not create.
    const baseUrl = await serveOn(3197, JSON.stringify({ hello: 'world' }));

    const probe = await probePostgrest(baseUrl);

    expect(probe.ready).toBe(false);
    expect(probe.answered).toContain('not a PostgREST catalogue');
  });
});

describe('the message a launcher throws when the child never started', () => {
  const aliveAndSilent: PostgrestChildState = {
    exitCode: null,
    signal: null,
    log: '',
    spawnError: undefined,
  };

  it('names a child that is alive and has logged nothing, and says how long it waited', () => {
    const message = describePostgrestStartupFailure({
      port: 3019,
      waitedMs: 90_100,
      timeoutMs: POSTGREST_STARTUP_TIMEOUT_MS,
      child: aliveAndSilent,
      probe: { ready: false, answered: undefined },
    });

    expect(message).toContain('ALIVE');
    expect(message).toContain('the child wrote nothing at all');
    expect(message).toContain('nothing is answering on 3019');
    expect(message).toContain('90.1s');
    expect(message).toContain('90.0s');
  });

  it('names a child that died, with its exit code and its log', () => {
    const message = describePostgrestStartupFailure({
      port: 3016,
      waitedMs: 412,
      timeoutMs: POSTGREST_STARTUP_TIMEOUT_MS,
      child: {
        exitCode: 3,
        signal: null,
        log: 'Starting PostgREST 16.4...\n',
        spawnError: undefined,
      },
      probe: { ready: false, answered: undefined },
    });

    expect(message).toContain('EXITED');
    expect(message).toContain('code 3');
    expect(message).toContain('Starting PostgREST 16.4...');
    expect(message).toContain('0.4s');
  });

  it('says that a silent exit 3 is the port not being free, because that is what it means', () => {
    // Measured, not guessed: PostgREST 16.4 exits 3 with NO error message when
    // it cannot bind its port. A reader who knows that does not have to
    // reproduce it to know what to look at.
    const message = describePostgrestStartupFailure({
      port: 3016,
      waitedMs: 40,
      timeoutMs: POSTGREST_STARTUP_TIMEOUT_MS,
      child: { exitCode: 3, signal: null, log: 'Starting PostgREST 16.4...\n', spawnError: undefined },
      probe: { ready: false, answered: undefined },
    });

    expect(message).toContain('cannot BIND its port');
  });

  it('names a child that could not be started at all', () => {
    const message = describePostgrestStartupFailure({
      port: 3019,
      waitedMs: 5,
      timeoutMs: POSTGREST_STARTUP_TIMEOUT_MS,
      child: { exitCode: null, signal: null, log: '', spawnError: 'spawn postgrest ENOENT' },
      probe: { ready: false, answered: undefined },
    });

    expect(message).toContain('COULD NOT START');
    expect(message).toContain('spawn postgrest ENOENT');
  });

  it('says what the port answered when the port answered something', () => {
    const message = describePostgrestStartupFailure({
      port: 3019,
      waitedMs: 90_100,
      timeoutMs: POSTGREST_STARTUP_TIMEOUT_MS,
      child: aliveAndSilent,
      probe: { ready: false, answered: 'the port answered HTTP 500' },
    });

    expect(message).toContain('the port answered HTTP 500');
  });
});
