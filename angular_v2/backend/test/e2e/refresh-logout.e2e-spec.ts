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
});
