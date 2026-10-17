import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';
import { DEFAULT_BLOCK_THRESHOLD } from '../../src/config/environment.js';
import { isBlocked } from '../../src/auth/throttle.js';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * Login orchestration, proven against a real pipeline: bootstrap roles, real
 * seed (which applies both migrations), the real Nest app, and real Postgres
 * writes. The database is throwaway (`login_e2e`), owned by the migration
 * role, and a dev-name guard refuses anything else — same discipline as
 * `test/rls/seed.spec.ts`.
 *
 * Case names are the attacks they prevent, per AGENTS.md §B8.
 */

const TEST_DB = 'login_e2e';
const SEED_PASSWORD = 'seed-test-password-123';
const TEST_JWT_SECRET = 'login-e2e-signing-secret-key-for-tests-0123456789';
const PROOF_TIMEOUT = 600_000;

/**
 * The password this suite authenticates `pgrst_authenticator` with.
 *
 * Read from `.env.test`, never written as a literal. It used to be the literal
 * `'pgrst'` here, matching the seed's own hardcoded fallback — and that shared
 * literal is precisely what hid the defect: both sides agreed, so a green run
 * left the CLUSTER holding a seed default that happened to equal the
 * configured value. `database/seed.ts` now writes the configured
 * `AUTHENTICATOR_PASSWORD` and nothing else, so this suite must read the same
 * value or it would be testing a password no configuration names.
 */
const AUTHENTICATOR_PASSWORD = loadTestEnvironment().authenticator.password;

loadTestEnvironment();

/** Runs SQL as the cluster superuser, throwing on failure. */
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
    throw new Error(`refusing to run the login e2e against the development database (${name})`);
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
    env: {
      ...process.env,
      DB_NAME: database,
      SEED_ADMIN_PASSWORD: SEED_PASSWORD,
    },
    encoding: 'utf8',
    timeout: 300_000,
  });
}

/** Reads state through the boundary the server itself uses: authenticator + elevated role. */
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

interface LoginBody {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: string;
  readonly expiresIn: number;
}

/**
 * `remoteAddress` is optional and defaulted to nothing, which leaves every existing case
 * on fastify's `127.0.0.1` default exactly as it was. The account-state cases below pass
 * one, because they need their two axes to be provably empty: every case in this file
 * that omits it shares ONE `ip_subnet` counter, and a case that depended on "the gate has
 * not blocked this name" would then be asserting a fact about the order this file happens
 * to run in.
 */
async function login(body: unknown, remoteAddress?: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: body as Record<string, unknown>,
    remoteAddress,
  });
}

/**
 * A user this suite owns, with a password it knows.
 *
 * **Not the seeded `admin`.** These cases disable an account and assert on its
 * timestamps, and an account the other cases in this file authenticate against would
 * couple them through a mutable fixture — the second one to run would fail for a reason
 * that has nothing to do with it. The insert goes through the same authenticator +
 * `SET ROLE app_admin` boundary the application uses, so a fixture that could not be
 * written in production fails here too.
 *
 * The cost is `12` because that is `BCRYPT_COST`, and the consequence of it being
 * anything else is that **every login below takes a different amount of time** and the
 * whole file becomes a timing assertion it never meant to make.
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
 * The row shapes the disable predicate has to tell apart, named for what they mean
 * rather than for the columns that hold them.
 *
 * Every timestamp below is the DATABASE's `now()` and never a value from this process.
 * That is not a style choice in a fixture either: the whole reason the shipped predicate
 * compares against `now()` is that the two clocks are two clocks, and a fixture that
 * wrote `new Date().toISOString()` would be testing the application clock while the
 * production code uses the other one — which is precisely the case where a disagreement
 * is invisible to a test that samples both from the same machine.
 */
type DisableShape = 'permanent' | 'suspension' | 'expired-suspension';

/** Satisfies `users_disabled_requires_actor_or_reason` with no invented administrator. */
const DISABLE_REASON = 'admin';

async function disableUser(userId: string, shape: DisableShape): Promise<void> {
  const setClause =
    shape === 'permanent'
      ? 'disabled_at = now(), disabled_until = NULL'
      : shape === 'suspension'
        ? "disabled_at = now() - interval '1 hour', disabled_until = now() + interval '1 hour'"
        : "disabled_at = now() - interval '2 hours', disabled_until = now() - interval '1 hour'";
  await withAdminClient(async (client) => {
    await client.query(`UPDATE users SET ${setClause}, disabled_reason = $2 WHERE id = $1`, [
      userId,
      DISABLE_REASON,
    ]);
  });
}

/** `last_login_at` as epoch milliseconds, or `null` — compared by value, never by identity. */
async function lastLoginAt(userId: string): Promise<number | null> {
  return withAdminClient(async (client) => {
    const result = await client.query<{ last_login_at: Date | null }>(
      'SELECT last_login_at FROM users WHERE id = $1',
      [userId],
    );
    return result.rows[0]?.last_login_at?.getTime() ?? null;
  });
}

/** Pins the column to a known-distant value so a following assertion has a real "before". */
async function pinLastLoginTo(userId: string, value: string): Promise<void> {
  await withAdminClient(async (client) => {
    await client.query('UPDATE users SET last_login_at = $2 WHERE id = $1', [userId, value]);
  });
}

/** The attempt rows the gate wrote, oldest first, with the keys the counters read. */
async function attemptsFor(username: string) {
  return withAdminClient(async (client) => {
    const result = await client.query<{
      status: string;
      username: string;
      ip: string | null;
      ip_normalized: string | null;
      ip_subnet: string | null;
    }>(
      'SELECT status, username, ip, ip_normalized, ip_subnet FROM login_attempts WHERE username = $1 ORDER BY created_at',
      [username],
    );
    return result.rows;
  });
}

/**
 * How many of those rows the gate counts as failures against this name — the same
 * predicate `countRecentFailures` uses, restated so a test can PROVE its refusals came
 * from the credential check rather than from the throttle.
 */
async function countedFailures(username: string): Promise<number> {
  return withAdminClient(async (client) => {
    const result = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM login_attempts WHERE username = $1 AND attempt_kind = 'login' AND status = 'failed' AND ip_normalized IS NOT NULL",
      [username],
    );
    return result.rows[0]?.count ?? 0;
  });
}

/**
 * A pinned value far enough in the past that "the column moved" and "the column still
 * holds what was written" cannot be confused — which is the whole reason these cases pin
 * rather than merely read.
 */
const DISTANT_PAST = '1999-01-01T00:00:00.000Z';

describe('login orchestration', () => {
  it('a valid admin login issues a verifiable access token carrying sub, role=app_admin and exp, plus a refresh token stored only as a hash', async () => {
    const response = await login({ username: 'admin', password: SEED_PASSWORD });

    expect(response.statusCode).toBe(200);
    const body = response.json<LoginBody>();
    expect(body.tokenType).toBe('Bearer');
    expect(body.expiresIn).toBe(900);

    const verifier = new JwtService({ secret: TEST_JWT_SECRET });
    const payload = await verifier.verifyAsync<{ sub: string; role: string; exp: number; iat: number; jti: string }>(body.accessToken);

    expect(payload.sub).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.role).toBe('app_admin');
    expect(['app_anon', 'app_member', 'app_admin']).toContain(payload.role);

    // The token's lifetime is asserted as a relationship BETWEEN ITS OWN CLAIMS,
    // never against a separately sampled `Date.now()`.
    //
    // The previous form compared `payload.exp` to `Date.now() / 1000 + 900` with a
    // 10-second tolerance, which made the result a function of how long the login
    // took rather than of the TTL. Login performs a bcrypt cost-12 comparison —
    // ~324ms idle, and well over a second on a loaded machine — so on a busy box a
    // perfectly correct token failed the assertion. Same defect as the delay
    // ceilings removed from brute-force.e2e-spec.ts.
    //
    // `exp - iat` is what "expiresIn" actually means, and it is exact. Comparing it
    // to the `expiresIn` the response advertised also pins the two together: a token
    // whose lifetime disagreed with the value handed to the client would fail here.
    expect(payload.exp - payload.iat).toBe(body.expiresIn);

    const rows = await withAdminClient(async (client) => {
      const result = await client.query<{ jti: string; token_hash: string; expires_at: string }>(
        'SELECT jti, token_hash, expires_at FROM refresh_tokens WHERE jti = $1',
        [payload.jti],
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    const expectedHash = createHash('sha256').update(body.refreshToken).digest('hex');
    expect(rows[0]?.token_hash).toBe(expectedHash);
    expect(rows[0]?.token_hash).not.toBe(body.refreshToken);
    expect(new Date(rows[0]?.expires_at ?? '').getTime()).toBeGreaterThan(Date.now());
  });

  it('a second login issues a different, opaque refresh token', async () => {
    const first = (await login({ username: 'admin', password: SEED_PASSWORD })).json<LoginBody>();
    const second = (await login({ username: 'admin', password: SEED_PASSWORD })).json<LoginBody>();

    expect(first.refreshToken).not.toBe(second.refreshToken);
    expect(first.accessToken).not.toBe(second.accessToken);
  });

  it('a successful login stamps last_activity_at, and a refused one does not', async () => {
    // **The producer is asserted HERE, not only in the database.** The RLS suite
    // proves `authz.record_user_activity()` writes the column; nothing else proved
    // that the application CALLS it. Deleting the `await recordActivity(...)` line
    // from `AuthService.issueSession()` would leave every other test in this
    // repository green, and the column NULL forever — which is not a degraded
    // feature, it is the dormant-account purge silently purging nothing while
    // reading as operational (`AGENTS.md` §2.1).
    //
    // The negative half is the one that pins it to SUCCESS. A stamp written on
    // every attempt would keep a dormant account alive forever, because an attacker
    // hammering a username would refresh its clock — so the failed login below must
    // leave the timestamp exactly where it was.
    const admin = await withAdminClient(async (client) => {
      const found = await client.query<{ id: string }>("SELECT id FROM users WHERE username = 'admin'");
      return found.rows[0];
    });
    expect(admin?.id, 'the seed did not create the admin account this test reads back').toBeDefined();

    // Pinned to a known-distant value first, rather than read and compared to
    // itself: "it is not NULL" is satisfied by any earlier login in the suite, and
    // a login that stamped nothing would pass it. The value is written directly so
    // the test does not depend on this file's execution order.
    const DORMANT = '2000-01-01T00:00:00.000Z';
    await withAdminClient(async (client) => {
      await client.query('UPDATE users SET last_activity_at = $2 WHERE id = $1', [admin?.id, DORMANT]);
    });

    const before = Date.now();
    expect((await login({ username: 'admin', password: SEED_PASSWORD })).statusCode).toBe(200);

    const stamped = await withAdminClient(async (client) => {
      const found = await client.query<{ last_activity_at: string | null }>(
        'SELECT last_activity_at FROM users WHERE id = $1',
        [admin?.id],
      );
      return found.rows[0]?.last_activity_at ?? null;
    });
    expect(stamped, 'a successful login did not stamp last_activity_at').not.toBeNull();
    expect(new Date(stamped ?? '').getTime(), 'the stamp is the distant value, so login did not move it').toBeGreaterThan(
      new Date(DORMANT).getTime(),
    );
    // The stamp is the function's own `now()`, so it is bracketed by the call rather
    // than compared to a separately sampled clock — the same rule §B8 applies to a
    // token's lifetime, for the same reason.
    expect(new Date(stamped ?? '').getTime()).toBeGreaterThanOrEqual(before - 2_000);
    expect(new Date(stamped ?? '').getTime()).toBeLessThanOrEqual(Date.now() + 2_000);

    // The refused login moves nothing. Compared as epoch milliseconds, because
    // `pg` hands back `timestamptz` as a `Date` and `Object.is` is never true for
    // two distinct Date objects — a `toBe` on them would report a difference where
    // there is none, which is the §B8 "assert on the value, not on its identity"
    // rule in a different costume.
    const failed = await login({ username: 'admin', password: 'wrong-password' });
    expect(failed.statusCode).toBe(401);
    const afterFailure = await withAdminClient(async (client) => {
      const found = await client.query<{ last_activity_at: string | null }>(
        'SELECT last_activity_at FROM users WHERE id = $1',
        [admin?.id],
      );
      return found.rows[0]?.last_activity_at ?? null;
    });
    expect(
      new Date(afterFailure ?? '').getTime(),
      'a REFUSED login stamped last_activity_at, which would keep a dormant account alive forever',
    ).toBe(new Date(stamped ?? '').getTime());
  });

  it('a wrong password is refused and the attempt is recorded', async () => {
    const response = await login({ username: 'admin', password: 'wrong-password' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ statusCode: 401, message: 'invalid credentials', error: 'Unauthorized' });

    const rows = await withAdminClient(async (client) => {
      const result = await client.query<{ status: string; username: string }>(
        "SELECT status, username FROM login_attempts WHERE status = 'failed' AND username = 'admin'",
      );
      return result.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.username).toBe('admin');
    }
  });

  it('an unknown username gets the same 401 body as a wrong password (no account-existence leak)', async () => {
    const unknownUser = await login({ username: 'no-such-user', password: 'anything' });
    const wrongPassword = await login({ username: 'admin', password: 'wrong-password' });

    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.json()).toEqual(wrongPassword.json());
  });

  it('a malformed body is refused with 400 by the strict validation pipe', async () => {
    const empty = await login({});
    const extraKey = await login({ username: 'admin', password: SEED_PASSWORD, role: 'app_admin' });

    expect(empty.statusCode).toBe(400);
    expect(extraKey.statusCode).toBe(400);
  });
});

/**
 * `0023` added four columns that record a decision and enforce nothing, and named the
 * login path as the half that was missing. These are the cases that make them a
 * control rather than a record.
 *
 * **Each case names a distinct account and a distinct source address, and that is
 * load-bearing rather than tidiness.** Every `401` below could be the throttle rather
 * than the refusal, and a test that cannot tell those apart proves nothing about the
 * refusal: the gate refuses at `DEFAULT_BLOCK_THRESHOLD`, so an account and an address
 * nothing has ever been tried against cannot be blocked. The one case that makes two
 * requests against one name says so out loud by running the gate's own `isBlocked`
 * over the rows that now exist. `test/e2e/brute-force.e2e-spec.ts` closes the
 * remaining gap by counting bcrypt compares, which is the only assertion that the
 * disabled account *paid* for the check.
 */
describe('a disabled account is refused exactly as a wrong password is', () => {
  it('returns the identical status and body for the correct password, so switching an account off tells a prober nothing', async () => {
    const username = 'switched-off';
    const password = 'a-password-the-attacker-does-not-have';
    const userId = await createUser(username, password);
    await disableUser(userId, 'permanent');

    const correctPassword = await login({ username, password }, '198.51.100.11');
    const wrongPassword = await login({ username, password: 'not-the-password' }, '198.51.100.11');

    // THE assertion. Compared to each other rather than to a literal, because the
    // property is "the two answers are the same", and asserting each against its own
    // expected body is how a suite stays green on two branches that have drifted apart.
    expect(correctPassword.statusCode).toBe(401);
    expect(correctPassword.json()).toEqual(wrongPassword.json());

    // And the wrong-password side is asserted literally too, so "both are the same
    // empty object" is not mistaken for a shared pass.
    expect(wrongPassword.json()).toEqual({
      statusCode: 401,
      message: 'invalid credentials',
      error: 'Unauthorized',
    });

    // Neither refusal was the THROTTLE. Two requests against a name with no prior
    // failures, so the gate counted 0 and then 1 — both under the threshold, by the
    // gate's own arithmetic rather than by a number restated here.
    const counted = await countedFailures(username);
    expect(counted).toBe(2);
    const blocked = isBlocked(counted, DEFAULT_BLOCK_THRESHOLD);
    expect(blocked, 'these refusals would be the GATE, so this case says nothing').toBe(false);

    // Nothing was minted: the response is not a token body with a status changed.
    expect(correctPassword.json()).not.toHaveProperty('accessToken');
    expect(correctPassword.json()).not.toHaveProperty('refreshToken');
  });

  it('still records a tracked failure, so hammering a switched-off account keeps spending the per-account budget', async () => {
    const username = 'switched-off-audited';
    const password = 'the-right-password-all-the-same';
    const userId = await createUser(username, password);
    await disableUser(userId, 'permanent');

    const refused = await login({ username, password }, '198.51.100.12');
    expect(refused.statusCode).toBe(401);

    const rows = await attemptsFor(username);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // `'failed'`, not `'succeeded'`: the attempt row is only flipped by the statement
    // that follows the refusal, so a refusal leaves the ledger saying exactly what a
    // wrong password leaves.
    expect(row?.status).toBe('failed');
    // The canonical keys are what `countRecentFailures` reads, so their presence is
    // what makes this attempt count. A row with NULL keys would be audited and
    // invisible to the counter — which is the failure mode §B6's per-account counting
    // exists to prevent.
    expect(row?.ip).toBe('198.51.100.12');
    expect(row?.ip_normalized).toBe('198.51.100.12');
    expect(row?.ip_subnet).toBe('198.51.100.12');
  });

  it('blocks a suspension that has not expired and admits one that has, so an hour is an hour', async () => {
    const username = 'suspended-not-yet';
    const password = 'a-password-for-a-suspended-account';
    const userId = await createUser(username, password);

    // Suspended for the next hour: the account exists, the password is right, and the
    // answer is still the wrong-password answer.
    await disableUser(userId, 'suspension');
    const duringSuspension = await login({ username, password }, '198.51.100.13');
    expect(duringSuspension.statusCode).toBe(401);
    expect(duringSuspension.json()).toEqual({
      statusCode: 401,
      message: 'invalid credentials',
      error: 'Unauthorized',
    });

    // THE case a bare `disabled_at IS NOT NULL` gets wrong. `disabled_until` is in the
    // past, so the suspension is over and the account signs in — with no administrator
    // having touched anything. An account suspended for an hour until somebody notices
    // is a support incident and a §2.1 control that reads as one and is not.
    await disableUser(userId, 'expired-suspension');
    const afterExpiry = await login({ username, password }, '198.51.100.13');
    expect(afterExpiry.statusCode, 'an expired suspension still refuses, so disabled_until is not consulted').toBe(200);
    expect(afterExpiry.json<LoginBody>().tokenType).toBe('Bearer');
  });

  it('stamps last_login_at on a successful credential check and leaves it NULL on every refusal', async () => {
    // `0023` names the column's whole meaning: "when this account last passed a
    // CREDENTIAL check… NULL means no successful authentication has ever been
    // recorded". That is a statement about AUTHENTICATION, and the half that keeps it
    // true is that nothing else writes it — which is why the refusals below are
    // asserted rather than assumed.
    const username = 'stamp-witness';
    const password = 'the-password-that-stamps';
    const userId = await createUser(username, password);

    // Never signed in, so NULL is a real "before" rather than a stamp an earlier case in
    // this file left behind.
    expect(await lastLoginAt(userId), 'a fixture that has never signed in is not NULL').toBeNull();

    // A wrong password stamps nothing. An attacker hammering a name would otherwise keep
    // the credential clock current and make the column lie about use.
    expect((await login({ username, password: 'wrong' }, '198.51.100.14')).statusCode).toBe(401);
    expect(await lastLoginAt(userId), 'a refused login stamped last_login_at').toBeNull();

    // A disabled account with the CORRECT password stamps nothing either — which is the
    // sharper half, because the credential check *succeeded* and only the account state
    // stopped it. A write placed before the refusal, or on the audit row, would pass the
    // two assertions above and fail this one.
    await disableUser(userId, 'permanent');
    expect((await login({ username, password }, '198.51.100.14')).statusCode).toBe(401);
    expect(await lastLoginAt(userId), 'a disabled account stamped last_login_at').toBeNull();

    // Lifted, and now it moves — from the DATABASE's clock, bracketed by the call
    // rather than compared to a separately sampled one, for the reason the
    // `last_activity_at` case above records.
    await withAdminClient(async (client) => {
      await client.query(
        'UPDATE users SET disabled_at = NULL, disabled_until = NULL, disabled_reason = NULL WHERE id = $1',
        [userId],
      );
    });
    const before = Date.now();
    expect((await login({ username, password }, '198.51.100.14')).statusCode).toBe(200);

    const stamped = await lastLoginAt(userId);
    expect(stamped, 'a successful credential check did not stamp last_login_at').not.toBeNull();
    expect(stamped ?? 0).toBeGreaterThanOrEqual(before - 2_000);
    expect(stamped ?? 0).toBeLessThanOrEqual(Date.now() + 2_000);

    // Pinned second, so the assertion is about the write MOVING the column rather than
    // about it being non-NULL — a write that kept the previous contents, or one that
    // wrote a constant, passes `not.toBeNull()` and fails here.
    await pinLastLoginTo(userId, DISTANT_PAST);
    const beforeSecond = Date.now();
    expect((await login({ username, password }, '198.51.100.14')).statusCode).toBe(200);
    const moved = await lastLoginAt(userId);
    const distant = new Date(DISTANT_PAST).getTime();
    expect(moved ?? 0, 'login left the pinned value, so the column was not written').toBeGreaterThan(distant);
    expect(moved ?? 0).toBeGreaterThanOrEqual(beforeSecond - 2_000);
  });
});
