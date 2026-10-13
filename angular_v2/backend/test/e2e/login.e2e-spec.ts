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

async function login(body: unknown) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: body as Record<string, unknown>,
  });
}

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
