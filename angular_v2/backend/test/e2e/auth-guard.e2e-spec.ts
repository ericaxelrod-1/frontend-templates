import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { databaseConfig, loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * The global JwtAuthGuard (W11 slice 4), proven against the real Nest app.
 *
 * This spec lives with the DB-backed e2e files for two reasons: the login and
 * refresh ordering cases (6 and 7) must reach the *handlers*, and the login
 * handler needs a live Postgres to exercise its throttle/audit path. The
 * guard itself never touches the database — it verifies claims only — so the
 * token matrix (cases 1–5) could run against an app without a pool, but
 * splitting the suite would put two halves of one contract in two places.
 *
 * Case names are the attacks they prevent, per AGENTS.md §B8.
 */

const TEST_DB = 'auth_guard_e2e';
const SEED_PASSWORD = 'seed-test-password-123';
const TEST_JWT_SECRET = 'guard-e2e-signing-secret-key-for-tests-0123456789';
const PROOF_TIMEOUT = 600_000;

/**
 * The password this suite's application authenticates `pgrst_authenticator`
 * with.
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
    throw new Error(`refusing to run the guard e2e against the development database (${name})`);
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

const GENERIC_401 = { statusCode: 401, message: 'unauthorized', error: 'Unauthorized' };

async function mint(payload: Record<string, unknown>, secret = TEST_JWT_SECRET): Promise<string> {
  const signer = new JwtService({ secret });
  const exp = Math.floor(Date.now() / 1000) + 900;
  return signer.signAsync({ jti: randomUUID(), exp, ...payload });
}

function getMe(headers: Record<string, string> = {}) {
  return app.inject({ method: 'GET', url: '/auth/me', headers });
}

describe('global JwtAuthGuard', () => {
  it('a validly-signed, unexpired token reaches /auth/me and the body carries its sub and role', async () => {
    const sub = randomUUID();
    const token = await mint({ sub, role: 'app_member' }, TEST_JWT_SECRET);

    const response = await getMe({ authorization: `Bearer ${token}` });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sub: string; role: string; expiresIn: number }>();
    expect(body.sub).toBe(sub);
    expect(body.role).toBe('app_member');
    expect(typeof body.expiresIn).toBe('number');
    expect(body.expiresIn).toBeGreaterThanOrEqual(0);
  });

  it('a request with no Authorization header is refused with the generic 401', async () => {
    const response = await getMe();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual(GENERIC_401);
  });

  it('a malformed Authorization header is refused with the same generic 401 and no reason leaked', async () => {
    const variants = ['Bearer', 'Bearer ', 'garbage', 'Bearer garbage-token', 'Basic dXNlcjpwYXNz'];

    const bodies: unknown[] = [];
    for (const header of variants) {
      const response = await getMe({ authorization: header });
      expect(response.statusCode).toBe(401);
      bodies.push(response.json());
    }
    for (const body of bodies) {
      expect(body).toEqual(GENERIC_401);
    }
    const distinctBodies = new Set(bodies.map((body) => JSON.stringify(body)));
    expect(distinctBodies.size).toBe(1);
  });

  it('an expired token is refused with the generic 401', async () => {
    const signer = new JwtService({ secret: TEST_JWT_SECRET });
    const token = await signer.signAsync({
      sub: randomUUID(),
      role: 'app_member',
      jti: randomUUID(),
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    const response = await getMe({ authorization: `Bearer ${token}` });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual(GENERIC_401);
  });

  it('a token signed with a different secret is refused with the generic 401', async () => {
    const token = await mint({ sub: randomUUID(), role: 'app_member' }, 'a-completely-different-signing-secret-key-000000000000');

    const response = await getMe({ authorization: `Bearer ${token}` });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual(GENERIC_401);
  });

  it('login stays public: no token required, and the handler reaches its credential path', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin', password: 'wrong-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      statusCode: 401,
      message: 'invalid credentials',
      error: 'Unauthorized',
    });

    const ok = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin', password: SEED_PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json<{ accessToken: string }>();
    const me = await getMe({ authorization: `Bearer ${body.accessToken}` });
    expect(me.statusCode).toBe(200);
  });

  it('refresh stays public: an unknown token gets the handler 401, not the guard 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'no-such-refresh-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      statusCode: 401,
      message: 'invalid refresh token',
      error: 'Unauthorized',
    });
  });
});
