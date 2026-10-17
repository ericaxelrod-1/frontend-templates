import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Client } from 'pg';
import type * as BcryptModule from 'bcrypt';
import type * as ThrottleModule from '../../src/auth/throttle.js';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * Brute-force stack, proven against a real pipeline: bootstrap roles, real
 * seed (which applies the migrations), the real Nest app, and real Postgres
 * writes. Throwaway database (`brute_force_e2e`), same discipline as
 * `login.e2e-spec.ts`.
 *
 * Case names are the attacks they prevent, per AGENTS.md §B8.
 *
 * The bcrypt module is wrapped (never replaced) in this file: the wrapper
 * counts compare calls — the deterministic "did the handler reach the
 * credential check" signal — and delegates to the real bcrypt, so hashing
 * itself is never faked. Fixtures live only in this spec, never in src/.
 *
 * `src/auth/throttle.ts` is wrapped the same way, for the same reason and under
 * the same discipline — see `loginExpectingGateDelay` below for why the delay
 * is observed rather than timed.
 */

const TEST_DB = 'brute_force_e2e';
const SEED_PASSWORD = 'seed-test-password-123';
const TEST_JWT_SECRET = 'brute-force-e2e-signing-secret-key-for-tests-012345';
const PROOF_TIMEOUT = 600_000;

const DELAY_SCHEDULE_SECONDS = '0,1,2,4';
const WINDOW = '600';

/**
 * The configured schedule in milliseconds, parsed once. Every delay expectation
 * in this file is indexed out of it rather than restated, so the schedule and
 * the assertions cannot drift apart (AGENTS.md §2.4).
 *
 * Index 1 is 1000ms — the smallest delay this suite can apply at all — and that
 * number is the whole reason three of these cases could not be asserted against
 * a clock: 1000ms of sleep plus a `bcrypt.compare` at cost 12 (~324ms idle,
 * measured over 4.6s under load) is indistinguishable from "no delay, slow
 * box".
 */
const SCHEDULED_DELAYS_MS: readonly number[] = DELAY_SCHEDULE_SECONDS.split(',').map(
  (seconds) => Number(seconds) * 1000,
);

/**
 * The password this suite authenticates `pgrst_authenticator` with.
 *
 * Read from `.env.test`, never written as a literal. It used to be the literal
 * `'pgrst'` here, matching the seed's own hardcoded fallback — and that shared
 * literal is precisely what hid the defect: both sides agreed, so a green run
 * left the CLUSTER holding a seed default that happened to equal the configured
 * value. `database/seed.ts` now writes the configured `AUTHENTICATOR_PASSWORD`
 * and nothing else, so this suite must read the same value or it would be
 * testing a password no configuration names.
 */
const AUTHENTICATOR_PASSWORD = loadTestEnvironment().authenticator.password;

loadTestEnvironment();

const compareStats = vi.hoisted(() => ({ calls: 0 }));

vi.mock('bcrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof BcryptModule>();
  const realCompare = actual.compare;
  const countingCompare = async (data: string | Buffer, hash: string): Promise<boolean> => {
    compareStats.calls += 1;
    return realCompare(data, hash);
  };
  return {
    ...actual,
    default: { ...actual, compare: countingCompare },
    compare: countingCompare,
  };
});

/**
 * Delay-decision recorder.
 *
 * `delayForFailures` is wrapped exactly as bcrypt's `compare` is: it records
 * what it decided and delegates to the real function, so the number
 * `auth.service.ts` receives — and the `setTimeout` it waits on — is the same
 * number it would have been without this file existing. Nothing about a
 * request's latency changes; only the *reading* of the decision does.
 */
const delayStats = vi.hoisted(() => ({ decided: [] as number[] }));

vi.mock('../../src/auth/throttle.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ThrottleModule>();
  const realDelayForFailures = actual.delayForFailures;
  const recordingDelayForFailures = (
    failures: number,
    schedule: readonly number[],
    capSeconds: number,
  ): number => {
    const decided = realDelayForFailures(failures, schedule, capSeconds);
    delayStats.decided.push(decided);
    return decided;
  };
  return { ...actual, delayForFailures: recordingDelayForFailures };
});

function psqlAsSuperuser(database: string, sql: string): string {
  const result = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-d', database, '-c', sql],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`superuser psql failed against ${database}: ${sql}\n${result.stderr}`);
  }
  return result.stdout;
}

function recreateDatabase(name: string): void {
  const devDb = databaseConfig().database;
  if (name === devDb || name === 'app_dev') {
    throw new Error(`refusing to run the brute-force e2e against the development database (${name})`);
  }
  psqlAsSuperuser(
    'postgres',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
  );
  psqlAsSuperuser('postgres', `DROP DATABASE IF EXISTS ${name}`);
  psqlAsSuperuser('postgres', `CREATE DATABASE ${name} OWNER ${databaseConfig().user}`);
}

function runSeed(database: string): SpawnSyncReturns<string> {
  return spawnSync('node', ['--experimental-strip-types', 'database/seed.ts'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DB_NAME: database, SEED_ADMIN_PASSWORD: SEED_PASSWORD },
    encoding: 'utf8',
    timeout: 300_000,
  });
}

async function withAdminClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const config = loadTestEnvironment().database;
  const client = new Client({
    host: config.host,
    port: config.port,
    user: 'pgrst_authenticator',
    password: AUTHENTICATOR_PASSWORD,
    database: TEST_DB,
  });
  await client.connect();
  try {
    await client.query('SET ROLE app_admin');
    return await fn(client);
  } finally {
    await client.end();
  }
}

let app: NestFastifyApplication;
let moduleRef: TestingModule;

beforeAll(async () => {
  recreateDatabase(TEST_DB);
  const seed = runSeed(TEST_DB);
  if (seed.status !== 0) {
    throw new Error(`seed failed:\n${seed.stdout}\n${seed.stderr}`);
  }

  process.env['DB_NAME'] = TEST_DB;
  process.env['JWT_SECRET'] = TEST_JWT_SECRET;
  process.env['PGRST_JWT_SECRET'] = TEST_JWT_SECRET;
  process.env['AUTHENTICATOR_PASSWORD'] = AUTHENTICATOR_PASSWORD;
  process.env['SECURITY_DELAY_SCHEDULE_SECONDS'] = DELAY_SCHEDULE_SECONDS;
  process.env['SECURITY_FAILURE_WINDOW_SECONDS'] = WINDOW;
  process.env['SECURITY_BLOCK_THRESHOLD'] = '5';
  process.env['SECURITY_IP_ALLOWLIST'] = '203.0.113.7';
  vi.resetModules();

  const { AppModule } = await import('../../src/app.module.js');
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, PROOF_TIMEOUT);

afterAll(async () => {
  try {
    await app?.close();
    await moduleRef?.close();
  } finally {
    // `database/seed.ts` runs a CLUSTER-scoped `ALTER ROLE … PASSWORD`, so the
    // cluster is only restored once this runs — and it must run even if closing
    // the app throws, because a suite that dies in teardown is exactly when the
    // cluster would be left behind. Idempotent: the seed writes the same
    // configured value this restores.
    restoreAuthenticatorPassword();
  }
});

async function loginFrom(body: unknown, remoteAddress: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: body as Record<string, unknown>,
    remoteAddress,
  });
}

/**
 * Drives one login and asserts the delay the gate decided, then the sleep that
 * decision produced. Two assertions, because neither alone is the property.
 *
 * `gate.delayMs` is the largest per-axis `delayForFailures` decision on the
 * request (the service maxes the account and IP ones), read from the recorder
 * rather than from the clock — so it is a pure function of the counted failures
 * and holds identically on a loaded box. That is what replaces the three
 * `toBeLessThan(1000)` wall-clock assertions: they conflated "no delay bucket
 * fired" with "the box was idle", and failed at 1171ms and 1622ms under load.
 *
 * The sleep is what the decision alone cannot show: it is the only thing that
 * catches `auth.service.ts` computing `gate.delayMs` and then not waiting on
 * it. It is asserted as a LOWER bound because `setTimeout` never fires early —
 * load can only make it larger — which is the opposite of the ceiling the
 * undelayed cases could never be given safely.
 *
 * An empty record means the gate chose no bucket without asking, because the
 * allowlist branch short-circuits to 0. It is not a dead recorder: the delayed
 * cases in this same suite read the same array and assert the scheduled delays
 * from it.
 */
async function loginExpectingGateDelay(body: unknown, remoteAddress: string, expectedDelayMs: number) {
  delayStats.decided.length = 0;
  const startedAt = Date.now();
  const response = await loginFrom(body, remoteAddress);
  const elapsedMs = Date.now() - startedAt;
  const decisions = [...delayStats.decided];
  const gateDelayMs: number = decisions.length === 0 ? 0 : Math.max(...decisions);

  expect(gateDelayMs).toBe(expectedDelayMs);
  // A zero delay has no floor to prove: there is nothing to wait out, and any
  // ceiling would measure this machine rather than the gate.
  if (expectedDelayMs > 0) {
    expect(elapsedMs).toBeGreaterThanOrEqual(expectedDelayMs);
  }

  return response;
}

function lastAttempt(username: string) {
  return withAdminClient(async (client) => {
    const result = await client.query<{
      status: string;
      username: string;
      ip: string | null;
      ip_normalized: string | null;
      ip_subnet: string | null;
    }>(
      'SELECT status, username, ip, ip_normalized, ip_subnet FROM login_attempts WHERE username = $1 ORDER BY created_at DESC LIMIT 1',
      [username],
    );
    return result.rows[0];
  });
}

/** Inserts a 'succeeded' row directly, the reset the counters key on (a real row, not a fake service). */
async function resetFailedPenalty(username: string): Promise<void> {
  await withAdminClient(async (client) => {
    await client.query("INSERT INTO login_attempts (username, ip, status) VALUES ($1, null, 'succeeded')", [
      username,
    ]);
  });
}

async function countTrackedFailed(username: string): Promise<number> {
  return withAdminClient(async (client) => {
    const result = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM login_attempts WHERE username = $1 AND status = 'failed' AND ip_normalized IS NOT NULL",
      [username],
    );
    return result.rows[0]?.count ?? 0;
  });
}

/**
 * A user this suite owns, with a password it knows, inserted through the same
 * authenticator + `SET ROLE app_admin` boundary the application uses — the same
 * discipline as `login.e2e-spec.ts`, and for the same reason: a fixture that could not
 * be written in production must fail here too.
 *
 * The cost is `12` because that is `BCRYPT_COST`. This file counts bcrypt calls, so a
 * hash at any other cost would make every timing this suite can observe meaningless.
 */
async function createUser(username: string, password: string): Promise<string> {
  const bcrypt = (await import('bcrypt')).default;
  return withAdminClient(async (client) => {
    const result = await client.query<{ id: string }>(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [username, `${username}@example.test`, await bcrypt.hash(password, 12)],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error(`the fixture for ${username} was not created`);
    }
    return id;
  });
}

/**
 * Switches an account off through the boundary, with the database's own clock supplying
 * every timestamp. Not a value from this process, for the reason `login.e2e-spec.ts`
 * states: a fixture written from `new Date()` would exercise the application clock
 * while the production predicate uses the other one.
 */
async function disablePermanently(userId: string): Promise<void> {
  await withAdminClient(async (client) => {
    await client.query(
      "UPDATE users SET disabled_at = now(), disabled_until = NULL, disabled_reason = 'admin' WHERE id = $1",
      [userId],
    );
  });
}

describe('brute-force login gate', () => {
  it('a failed credential attempt is audited before bcrypt, and a blocked attempt neither reaches bcrypt nor evades audit', async () => {
    const username = 'ordering-victim';
    await resetFailedPenalty(username);
    compareStats.calls = 0;

    const failed = await loginFrom({ username, password: 'wrong' }, '10.1.1.1');
    expect(failed.statusCode).toBe(401);
    expect(failed.json()).toEqual({ statusCode: 401, message: 'invalid credentials', error: 'Unauthorized' });
    expect(compareStats.calls).toBe(1);
    const audited = await lastAttempt(username);
    expect(audited?.status).toBe('failed');
    expect(audited?.ip_normalized).toBe('10.1.1.1');

    // Exhaust the account counter: five distinct IPs, one failure each — the
    // IP-side counter never trips, the account-side threshold does.
    for (const ip of ['10.2.0.1', '10.2.0.2', '10.2.0.3', '10.2.0.4', '10.2.0.5']) {
      await loginFrom({ username, password: 'wrong' }, ip);
    }

    compareStats.calls = 0;
    const blocked = await loginFrom({ username, password: 'wrong' }, '10.3.3.3');
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json()).toEqual({ statusCode: 401, message: 'invalid credentials', error: 'Unauthorized' });
    expect(compareStats.calls).toBe(0);
    const blockedAudit = await lastAttempt(username);
    expect(blockedAudit?.status).toBe('failed');
    expect(blockedAudit?.ip).toBe('10.3.3.3');
  });

  it('per-account failure counting drives a progressive delay that escalates with the count', async () => {
    const username = 'throttle-victim';
    await resetFailedPenalty(username);

    const clear = await loginExpectingGateDelay({ username, password: 'wrong' }, '10.9.0.1', 0);
    expect(clear.statusCode).toBe(401);
    // k=0 on this request (no counted failures yet): the gate decides 0, and
    // the request is not delayed.
    // k=1, k=2, k=3 walk the schedule: each decision AND the wait it produced.
    await loginExpectingGateDelay({ username, password: 'wrong' }, '10.9.0.2', SCHEDULED_DELAYS_MS[1]);
    await loginExpectingGateDelay({ username, password: 'wrong' }, '10.9.0.3', SCHEDULED_DELAYS_MS[2]);
    await loginExpectingGateDelay({ username, password: 'wrong' }, '10.9.0.4', SCHEDULED_DELAYS_MS[3]);
  });

  it('the same host written as different IP string forms accumulates one counter and after threshold both are delayed', async () => {
    const username = 'rotation-victim';
    await resetFailedPenalty(username);

    await loginFrom({ username, password: 'wrong' }, '1.2.3.4');
    await loginFrom({ username, password: 'wrong' }, '::ffff:1.2.3.4');
    await loginFrom({ username, password: 'wrong' }, '01.2.3.04');

    const rows = await withAdminClient(async (client) => {
      const result = await client.query<{ ip_normalized: string; ip_subnet: string }>(
        "SELECT ip_normalized, ip_subnet FROM login_attempts WHERE username = $1 AND status = 'failed' AND ip_normalized IS NOT NULL ORDER BY created_at",
        [username],
      );
      return result.rows;
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.ip_normalized).toBe('1.2.3.4');
      expect(row.ip_subnet).toBe('1.2.3.4');
    }

    // Same host, three spellings: one normalized key, one counter, and a
    // request from outside it still lands on the capped bucket.
    await loginExpectingGateDelay({ username: 'rotation-other', password: 'wrong' }, '::ffff:1.2.3.4', SCHEDULED_DELAYS_MS[3]);
    await loginExpectingGateDelay({ username: 'rotation-other-2', password: 'wrong' }, '1.2.3.4', SCHEDULED_DELAYS_MS[3]);
  });

  it('IPv6 failures from the same /64 aggregate one subnet counter; addresses outside the /64 do not', async () => {
    await resetFailedPenalty('subnet-victim');
    await loginFrom({ username: 'subnet-victim', password: 'wrong' }, '2001:db8:aa:bb::1');
    await loginFrom({ username: 'subnet-insider', password: 'wrong' }, '2001:db8:aa:bb::2');

    const rows = await withAdminClient(async (client) => {
      const result = await client.query<{ ip_subnet: string }>(
        "SELECT DISTINCT ip_subnet FROM login_attempts WHERE ip_subnet IS NOT NULL AND status = 'failed' AND ip_subnet LIKE '2001:db8:aa:bb%'",
        [],
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ip_subnet).toBe('2001:db8:aa:bb::/64');

    // Inside the /64: the subnet counter keys the delay for a different account.
    await loginExpectingGateDelay({ username: 'subnet-insider', password: 'wrong' }, '2001:db8:aa:bb::9', SCHEDULED_DELAYS_MS[2]);

    // Outside the /64: a different subnet and an account with no failures, so
    // neither axis reaches a counted failure and the gate decides 0. This is
    // one of the three cases that used to assert `toBeLessThan(1000)` on the
    // wall clock, which a busy box fails on a correctly undelayed request.
    await loginExpectingGateDelay({ username: 'subnet-outsider', password: 'wrong' }, '2001:db8:cc:dd::1', 0);
  });

  it('an allowlisted source address is never delayed, never blocked, and contributes no counter rows', async () => {
    const username = 'allow-victim';
    await resetFailedPenalty(username);

    for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4', '198.51.100.5']) {
      await loginFrom({ username, password: 'wrong' }, ip);
    }

    // The account is blocked from every non-allowlisted source.
    compareStats.calls = 0;
    const blockedRequest = await loginFrom({ username, password: 'wrong' }, '198.51.100.6');
    expect(blockedRequest.statusCode).toBe(401);
    expect(compareStats.calls).toBe(0);

    // From the allowlisted address the gate skips: no delay, compare runs, generic 401.
    compareStats.calls = 0;
    const allowlisted = await loginExpectingGateDelay({ username, password: 'wrong' }, '203.0.113.7', 0);
    expect(allowlisted.statusCode).toBe(401);
    expect(compareStats.calls).toBe(1);

    // The allowlisted request wrote no counter row: ip_normalized stays NULL.
    const allowRow = await lastAttempt(username);
    expect(allowRow?.status).toBe('failed');
    expect(allowRow?.ip).toBe('203.0.113.7');
    expect(allowRow?.ip_normalized).toBeNull();
    expect(allowRow?.ip_subnet).toBeNull();
    // 5 real failures with tracked IPs, plus the 198.51.100.6 blocked attempt: a
    // throttled refusal is still a tracked failed row (security.md audits it
    // like any other surface). The allowlisted 203.0.113.7 row is NULL-keyed,
    // so it adds nothing here — that is the property under test.
    expect(await countTrackedFailed(username)).toBe(6);
  });

  it('a successful password clears the account penalty for the account', async () => {
    const username = 'admin';
    await resetFailedPenalty(username);

    await loginFrom({ username, password: 'wrong' }, '7.7.7.7');
    await loginFrom({ username, password: 'wrong' }, '7.7.7.7');

    // k=2 → the next attempt (even with the right password) waits schedule[2].
    const success = await loginExpectingGateDelay({ username, password: SEED_PASSWORD }, '7.7.7.7', SCHEDULED_DELAYS_MS[2]);
    expect(success.statusCode).toBe(200);

    const body = success.json<{ accessToken: string }>();
    expect(body.accessToken).toBeTruthy();

    // The success row reset the counters: the next attempt is unthrottled.
    const after = await loginExpectingGateDelay({ username, password: 'wrong' }, '7.7.7.7', 0);
    expect(after.statusCode).toBe(401);
  });

  /**
   * The disable check runs AFTER bcrypt, and this file is the only place that can prove
   * it: it already wraps `bcrypt.compare` with a counter, and a counter is the
   * deterministic "did the handler reach the credential check" signal. Everything else
   * about this case is already covered by `login.e2e-spec.ts`; what is asserted here is
   * the thing a status code cannot show.
   *
   * A check placed above the compare would answer in the time of two indexed lookups
   * for exactly the requests where the account exists and is switched off — which is
   * the same oracle as a distinct message, delivered over a channel the message
   * argument never inspects. There is no wall-clock assertion here on purpose: a
   * `toBeGreaterThan` on latency would fail on a loaded box and pass on an idle one for
   * the wrong reasons. The number of compares does not depend on the machine.
   */
  it('a disabled account still pays for the compare, so neither its latency nor its counter discloses that it is switched off', async () => {
    const off = 'disabled-timing-victim';
    const on = 'enabled-timing-victim';
    const password = 'the-correct-password-for-both-accounts';
    await resetFailedPenalty(off);
    await resetFailedPenalty(on);

    const offId = await createUser(off, password);
    await disablePermanently(offId);
    await createUser(on, password);

    // Same source address, same password, one request apart. The ONLY difference
    // between them is the `disabled_at` an administrator wrote, so the pair isolates
    // the check: anything else that differed would be a fixture bug, and anything the
    // two share cannot be the disclosure.
    compareStats.calls = 0;
    const refused = await loginFrom({ username: off, password }, '10.7.0.1');
    const comparedForRefusal = compareStats.calls;

    compareStats.calls = 0;
    const admitted = await loginFrom({ username: on, password }, '10.7.0.1');
    const comparedForSuccess = compareStats.calls;

    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toEqual({ statusCode: 401, message: 'invalid credentials', error: 'Unauthorized' });
    expect(admitted.statusCode).toBe(200);

    // THE assertion: the disabled account cost exactly as much CPU as the live one.
    // Zero here is the defect this case exists for — it would mean the handler answered
    // without ever comparing a password, which is both a timing oracle and an
    // unauthenticated bypass of the whole credential check.
    expect(comparedForRefusal, 'a disabled account skipped the bcrypt compare').toBe(1);
    expect(comparedForRefusal).toBe(comparedForSuccess);

    // And it is still counted. `gate()` runs before the credential check and its row is
    // only flipped to 'succeeded' past the refusal, so a disabled account leaves one
    // TRACKED failure — the counter's own keys set — exactly as a wrong password does.
    // Not exempting it is what keeps the §B6 abuse signal honest about traffic aimed at
    // a name somebody has already acted on.
    expect(await countTrackedFailed(off)).toBe(1);
    expect((await lastAttempt(off))?.status).toBe('failed');
    expect(await countTrackedFailed(on)).toBe(0);

    // The admitted account is not a fixture accident: its password really did verify,
    // which is what makes `comparedForRefusal === comparedForSuccess` a statement about
    // the disable rather than about two accounts that both failed.
    const issued = await withAdminClient(async (client) => {
      const result = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE u.username = $1',
        [on],
      );
      return result.rows[0]?.count ?? 0;
    });
    expect(issued, 'the live account issued no session, so the pair proves nothing').toBeGreaterThan(0);
  });
});
