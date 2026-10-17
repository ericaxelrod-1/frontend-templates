import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * Refresh rotation and logout, proven against a real pipeline: bootstrap
 * roles, real seed (which applies both migrations), the real Nest app, and
 * real Postgres writes. The database is throwaway (`refresh_logout_e2e`),
 * owned by the migration role, and a dev-name guard refuses anything else —
 * same discipline as `login.e2e-spec.ts`.
 *
 * Case names are the attacks they prevent, per AGENTS.md §B8.
 */

const TEST_DB = 'refresh_logout_e2e';
const SEED_PASSWORD = 'seed-test-password-123';
const TEST_JWT_SECRET = 'login-e2e-signing-secret-key-for-tests-0123456789';
const PROOF_TIMEOUT = 600_000;

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
    throw new Error(`refusing to run the refresh/logout e2e against the development database (${name})`);
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

interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: string;
  readonly expiresIn: number;
}

async function login(body: unknown) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: body as Record<string, unknown>,
  });
}

async function refresh(body: unknown) {
  return app.inject({
    method: 'POST',
    url: '/auth/refresh',
    payload: body as Record<string, unknown>,
  });
}

async function logout(body: unknown) {
  return app.inject({
    method: 'POST',
    url: '/auth/logout',
    payload: body as Record<string, unknown>,
  });
}

function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface RefreshTokenRow {
  readonly id: string;
  readonly jti: string;
  readonly token_hash: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
  readonly rotated_to: string | null;
}

async function rowByHash(token: string): Promise<RefreshTokenRow | undefined> {
  const rows = await withAdminClient(async (client) => {
    const result = await client.query<RefreshTokenRow>(
      'SELECT id, jti, token_hash, expires_at, revoked_at, rotated_to FROM refresh_tokens WHERE token_hash = $1',
      [hashOf(token)],
    );
    return result.rows;
  });
  return rows[0];
}

async function rowCount(): Promise<number> {
  const rows = await withAdminClient(async (client) => {
    const result = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM refresh_tokens',
    );
    return result.rows;
  });
  return rows[0]?.count ?? 0;
}

async function mintChain(depth: number): Promise<TokenPair[]> {
  const chain: TokenPair[] = [];
  const first = (await login({ username: 'admin', password: SEED_PASSWORD })).json<TokenPair>();
  chain.push(first);
  for (let i = 1; i < depth; i++) {
    const next = (await refresh({ refreshToken: chain[i - 1]?.refreshToken })).json<TokenPair>();
    chain.push(next);
  }
  return chain;
}

/**
 * The account's `last_activity_at`, as epoch milliseconds, or `null`.
 *
 * `pg` returns `timestamptz` as a `Date`, and `Object.is` is never true for two
 * distinct `Date` objects — so every comparison of a timestamp in this file goes
 * through `getTime()`. Comparing the objects themselves would report a difference
 * where there is none, which is a test that fails for a reason nobody can act on.
 */
async function lastActivityAt(userId: string): Promise<number | null> {
  return withAdminClient(async (client) => {
    const result = await client.query<{ last_activity_at: Date | null }>(
      'SELECT last_activity_at FROM users WHERE id = $1',
      [userId],
    );
    return result.rows[0]?.last_activity_at?.getTime() ?? null;
  });
}

/** The seeded admin's id, read through the boundary rather than assumed. */
async function adminId(): Promise<string> {
  return withAdminClient(async (client) => {
    const result = await client.query<{ id: string }>("SELECT id FROM users WHERE username = 'admin'");
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error('the seed did not create the admin account this suite reads back');
    }
    return id;
  });
}

/**
 * Pins the column to a known-distant value, so a following assertion compares
 * against a real "before" rather than against whatever an earlier case left.
 */
async function pinActivityTo(userId: string, value: string): Promise<void> {
  await withAdminClient(async (client) => {
    await client.query('UPDATE users SET last_activity_at = $2 WHERE id = $1', [userId, value]);
  });
}


/**
 * A user this suite owns, with a password it knows.
 *
 * **Not the seeded `admin`.** The case below disables an account, and doing that to the
 * account every other case in this file authenticates as would couple them through a
 * mutable fixture. The insert goes through the same authenticator + `SET ROLE app_admin`
 * boundary the application uses, so a fixture that could not be written in production
 * fails here too. The cost is `12` because that is `BCRYPT_COST`.
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

/** Switched off, with the database's clock and a reason rather than an invented actor. */
async function disablePermanently(userId: string): Promise<void> {
  await withAdminClient(async (client) => {
    await client.query(
      "UPDATE users SET disabled_at = now(), disabled_until = NULL, disabled_reason = 'security' WHERE id = $1",
      [userId],
    );
  });
}

/**
 * Lifted, the way an administrator would: all three `disabled_*` columns go, so the row
 * is left in the state a never-disabled account is in. Clearing only `disabled_at` would
 * pass the sign-in assertion below and leave a stale reason on a live account, which is a
 * row an investigator reads as "disabled, and no explanation for it".
 */
async function enable(userId: string): Promise<void> {
  await withAdminClient(async (client) => {
    await client.query(
      'UPDATE users SET disabled_at = NULL, disabled_until = NULL, disabled_reason = NULL WHERE id = $1',
      [userId],
    );
  });
}

/** `last_login_at` as epoch milliseconds, or `null` — by value, never by identity. */
async function lastLoginAt(userId: string): Promise<number | null> {
  return withAdminClient(async (client) => {
    const result = await client.query<{ last_login_at: Date | null }>(
      'SELECT last_login_at FROM users WHERE id = $1',
      [userId],
    );
    return result.rows[0]?.last_login_at?.getTime() ?? null;
  });
}

/** Pins the credential clock to a known-distant value, for the same reason as above. */
async function pinLastLoginTo(userId: string, value: string): Promise<void> {
  await withAdminClient(async (client) => {
    await client.query('UPDATE users SET last_login_at = $2 WHERE id = $1', [
      userId,
      value,
    ]);
  });
}

const DORMANT = '2000-01-01T00:00:00.000Z';
describe('refresh rotation and logout', () => {
  it('a valid refresh rotates the pair: new distinct tokens, old row revoked and linked to the new row', async () => {
    const first = (await login({ username: 'admin', password: SEED_PASSWORD })).json<TokenPair>();

    const response = await refresh({ refreshToken: first.refreshToken });

    expect(response.statusCode).toBe(200);
    const body = response.json<TokenPair>();
    expect(body.tokenType).toBe('Bearer');
    expect(body.expiresIn).toBe(900);
    expect(body.refreshToken).not.toBe(first.refreshToken);
    expect(body.accessToken).not.toBe(first.accessToken);

    const verifier = new JwtService({ secret: TEST_JWT_SECRET });
    const payload = await verifier.verifyAsync<{ sub: string; role: string; exp: number; jti: string }>(
      body.accessToken,
    );
    expect(payload.role).toBe('app_admin');
    expect(payload.sub).toMatch(/^[0-9a-f-]{36}$/);

    const oldRow = await rowByHash(first.refreshToken);
    expect(oldRow).toBeDefined();
    expect(oldRow?.revoked_at).not.toBeNull();
    expect(oldRow?.rotated_to).not.toBeNull();

    const newRow = await rowByHash(body.refreshToken);
    expect(newRow).toBeDefined();
    expect(newRow?.revoked_at).toBeNull();
    expect(newRow?.rotated_to).toBeNull();
    expect(newRow?.jti).toBe(payload.jti);
    expect(newRow?.token_hash).toBe(hashOf(body.refreshToken));
    expect(newRow?.token_hash).not.toBe(body.refreshToken);
    expect(oldRow?.rotated_to).toBe(newRow?.id);
    expect(new Date(newRow?.expires_at ?? '').getTime()).toBeGreaterThan(Date.now());
  });

  it('replaying a rotated-out token is refused and the revocation kills the whole family, including the live leaf', async () => {
    const chain = await mintChain(3);

    const replay = await refresh({ refreshToken: chain[0]?.refreshToken });

    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({
      statusCode: 401,
      message: 'invalid refresh token',
      error: 'Unauthorized',
    });

    const original = await rowByHash(chain[0]?.refreshToken ?? '');
    const middle = await rowByHash(chain[1]?.refreshToken ?? '');
    const liveLeaf = await rowByHash(chain[2]?.refreshToken ?? '');
    expect(original?.revoked_at).not.toBeNull();
    expect(middle?.revoked_at).not.toBeNull();
    expect(liveLeaf?.revoked_at).not.toBeNull();

    const leafChain = await withAdminClient(async (client) => {
      const result = await client.query<{ revoked: boolean }>(
        'SELECT revoked_at IS NOT NULL AS revoked FROM refresh_tokens WHERE rotated_to IS NOT NULL OR revoked_at IS NOT NULL',
      );
      return result.rows;
    });
    expect(leafChain.length).toBeGreaterThan(0);
    for (const row of leafChain) {
      expect(row.revoked).toBe(true);
    }
  });

  it('a tampered refresh token is refused with the generic 401 body and no rotation happens', async () => {
    const before = await rowCount();

    const response = await refresh({ refreshToken: 'totally-made-up-garbage-token' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      statusCode: 401,
      message: 'invalid refresh token',
      error: 'Unauthorized',
    });
    expect(await rowCount()).toBe(before);
  });

  it('an expired refresh token is refused and the row is left unrotated', async () => {
    const first = (await login({ username: 'admin', password: SEED_PASSWORD })).json<TokenPair>();
    await withAdminClient(async (client) => {
      await client.query(
        "UPDATE refresh_tokens SET expires_at = now() - interval '1 hour' WHERE token_hash = $1",
        [hashOf(first.refreshToken)],
      );
    });
    const before = await rowCount();

    const response = await refresh({ refreshToken: first.refreshToken });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      statusCode: 401,
      message: 'invalid refresh token',
      error: 'Unauthorized',
    });
    const row = await rowByHash(first.refreshToken);
    expect(row?.revoked_at).toBeNull();
    expect(row?.rotated_to).toBeNull();
    expect(await rowCount()).toBe(before);
  });

  it('logout revokes the presented token and refreshing it afterwards is refused', async () => {
    const first = (await login({ username: 'admin', password: SEED_PASSWORD })).json<TokenPair>();

    const response = await logout({ refreshToken: first.refreshToken });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    const row = await rowByHash(first.refreshToken);
    expect(row?.revoked_at).not.toBeNull();

    const replay = await refresh({ refreshToken: first.refreshToken });
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({
      statusCode: 401,
      message: 'invalid refresh token',
      error: 'Unauthorized',
    });
  });

  it('logout of a garbage token returns the same 204 as logout of a valid token, and logout is idempotent', async () => {
    const valid = (await login({ username: 'admin', password: SEED_PASSWORD })).json<TokenPair>();

    const validLogout = await logout({ refreshToken: valid.refreshToken });
    const validLogoutAgain = await logout({ refreshToken: valid.refreshToken });
    const garbageLogout = await logout({ refreshToken: 'garbage-token-with-no-row' });

    expect(validLogout.statusCode).toBe(204);
    expect(validLogout.body).toBe('');
    expect(validLogoutAgain.statusCode).toBe(204);
    expect(validLogoutAgain.body).toBe('');
    expect(garbageLogout.statusCode).toBe(204);
    expect(garbageLogout.body).toBe('');
  });

  it('a REFRESH stamps last_activity_at, which is the only observation a read-only PostgREST client produces', async () => {
    // **The producer that carries the whole feature.** `src/auth/last-activity.ts`
    // defines activity as re-authentication, and says plainly that a user who only
    // READS through PostgREST is invisible to it. A refresh is what makes that gap
    // a lag of one access-token lifetime instead of unbounded — so if THIS call
    // stopped recording, the population the dormant-account purge exists for would
    // silently look dormant while it was in use, and the account-scan tests in
    // `test/rls` would stay green because they drive the SQL directly.
    const user = await adminId();
    const first = (await login({ username: 'admin', password: SEED_PASSWORD })).json<TokenPair>();
    // Pinned AFTER the login, so the assertion is about the refresh and not about a
    // stamp the login left one statement earlier.
    await pinActivityTo(user, DORMANT);

    const before = Date.now();
    expect((await refresh({ refreshToken: first.refreshToken })).statusCode).toBe(200);

    const stamped = await lastActivityAt(user);
    expect(stamped, 'a refresh did not stamp last_activity_at').not.toBeNull();
    expect(stamped, 'the refresh left the pinned value, so nothing moved it').toBeGreaterThan(new Date(DORMANT).getTime());
    expect(stamped ?? 0).toBeGreaterThanOrEqual(before - 2_000);
    expect(stamped ?? 0).toBeLessThanOrEqual(Date.now() + 2_000);
  });

  it('a REFUSED refresh stamps nothing, so a replay attack cannot keep a dormant account alive', async () => {
    const user = await adminId();
    const first = (await login({ username: 'admin', password: SEED_PASSWORD })).json<TokenPair>();
    expect((await refresh({ refreshToken: first.refreshToken })).statusCode).toBe(200);
    await pinActivityTo(user, DORMANT);

    const replay = await refresh({ refreshToken: first.refreshToken });
    expect(replay.statusCode).toBe(401);

    // This is the half that makes the producer a measurement of AUTHENTICATED
    // activity: an unauthenticated attempt must never move the clock, or hammering
    // a dormant account's refresh token would keep it permanently out of the purge.
    expect(
      await lastActivityAt(user),
      'a REFUSED refresh stamped last_activity_at — an attacker could keep a dormant account alive forever',
    ).toBe(new Date(DORMANT).getTime());
  });

  it('a logout stamps last_activity_at, and a garbage logout stamps nothing', async () => {
    // The LAST event an account produces is the one that starts its dormant clock,
    // so an account that logs out and never returns is exactly the account this
    // feature is for. The garbage half is the same control as above: an
    // unauthenticated caller must not be able to write the column at all.
    const user = await adminId();
    const session = (await login({ username: 'admin', password: SEED_PASSWORD })).json<TokenPair>();

    await pinActivityTo(user, DORMANT);
    const before = Date.now();
    expect((await logout({ refreshToken: session.refreshToken })).statusCode).toBe(204);

    const stamped = await lastActivityAt(user);
    expect(stamped, 'a logout did not stamp last_activity_at').not.toBeNull();
    expect(stamped ?? 0).toBeGreaterThanOrEqual(before - 2_000);
    expect(stamped ?? 0).toBeLessThanOrEqual(Date.now() + 2_000);

    // Garbage: no row, so no user, so no write.
    await pinActivityTo(user, DORMANT);
    expect((await logout({ refreshToken: 'garbage-token-with-no-row' })).statusCode).toBe(204);
    expect(await lastActivityAt(user), 'a logout for a token with no row stamped last_activity_at').toBe(
      new Date(DORMANT).getTime(),
    );
  });

  /**
   * A disable enforced only on `login` is not a disable. A session keeps proving itself
   * here without ever touching a password again, so an account that cannot sign in can
   * still mint a fresh access token every thirty seconds for as long as it keeps
   * presenting the token it already holds — which is the whole of "not disabled".
   */
  it('a disabled account cannot mint a new access token by refreshing, and the refusal consumes nothing', async () => {
    const username = 'switched-off-refresh';
    const password = 'the-password-for-a-disabled-session';
    const userId = await createUser(username, password);

    // A real session, minted while the account was live, so what is refused below is a
    // valid token rather than a forged one.
    const session = (await login({ username, password })).json<TokenPair>();
    const minted = await rowByHash(session.refreshToken);
    expect(minted?.revoked_at, 'the fixture did not mint a live session').toBeNull();

    await disablePermanently(userId);
    const before = await rowCount();

    const response = await refresh({ refreshToken: session.refreshToken });

    expect(response.statusCode).toBe(401);
    // The same body an unknown, revoked, replayed or expired token gets. A "your
    // account is disabled" here would hand an attacker the same shortlist of acted-on
    // accounts that the login route refuses to give them.
    expect(response.json()).toEqual({
      statusCode: 401,
      message: 'invalid refresh token',
      error: 'Unauthorized',
    });
    expect(await rowCount(), 'the refusal minted a session anyway').toBe(before);

    // The token is untouched, which is what makes a TEMPORARY disable resumable rather
    // than a forced sign-out. Asserted as an unrotated row rather than inferred from
    // the 401, because "the throw happens before the rotation" is the claim and the row
    // is the evidence.
    const afterRefusal = await rowByHash(session.refreshToken);
    const revoked = afterRefusal?.revoked_at;
    expect(revoked, 'a refusal revoked the token, so a temporary disable forces a sign-in').toBeNull();
    expect(afterRefusal?.rotated_to).toBeNull();

    // Lifted, and the same token works — the two halves together say the refusal is a
    // gate and not a revocation.
    await enable(userId);
    expect((await refresh({ refreshToken: session.refreshToken })).statusCode).toBe(200);
  });

  /**
   * `0023`: `last_activity_at` is what the application OBSERVED and `last_login_at` is
   * when a credential last passed its check, and "collapsing them would let a broad
   * activity signal overwrite an authentication fact". A refresh is the broadest signal
   * this service has — it fires for every read-heavy session — so it is the one route
   * where the collapse would be most visible.
   */
  it('a refresh stamps last_activity_at and never last_login_at, so a session cannot rewrite the credential fact', async () => {
    const user = await adminId();
    const session = (await login({ username: 'admin', password: SEED_PASSWORD })).json<TokenPair>();
    // Pinned AFTER the login, so this is about the refresh and not about a stamp the
    // login left one statement earlier.
    await pinActivityTo(user, DORMANT);
    await pinLastLoginTo(user, DORMANT);

    expect((await refresh({ refreshToken: session.refreshToken })).statusCode).toBe(200);

    const activity = await lastActivityAt(user);
    expect(activity, 'a refresh did not stamp last_activity_at').not.toBeNull();
    expect(activity ?? 0).toBeGreaterThan(new Date(DORMANT).getTime());

    // THE assertion. A refresh proves the SESSION, not the password, so the column that
    // answers "when did a credential last succeed" must not move. An attacker holding a
    // stolen refresh token could otherwise keep that column current indefinitely.
    // `DORMANT` read as epoch milliseconds, because `pg` hands back a `Date` and
    // `Object.is` is never true for two distinct Date objects.
    const pinned = new Date(DORMANT).getTime();
    const untouched = 'a refresh stamped last_login_at, so a stolen refresh token can keep the credential clock current forever';
    expect(await lastLoginAt(user), untouched).toBe(pinned);
  });

  it('a REFUSED refresh stamps neither column, so an unauthenticated caller can write no fact at all', async () => {
    const user = await adminId();
    const session = (await login({ username: 'admin', password: SEED_PASSWORD })).json<TokenPair>();
    expect((await refresh({ refreshToken: session.refreshToken })).statusCode).toBe(200);
    await pinActivityTo(user, DORMANT);
    await pinLastLoginTo(user, DORMANT);

    expect((await refresh({ refreshToken: session.refreshToken })).statusCode).toBe(401);

    const pinned = new Date(DORMANT).getTime();
    expect(await lastActivityAt(user), 'a refused refresh stamped last_activity_at').toBe(pinned);
    expect(await lastLoginAt(user), 'a refused refresh stamped last_login_at').toBe(pinned);
  });
});
