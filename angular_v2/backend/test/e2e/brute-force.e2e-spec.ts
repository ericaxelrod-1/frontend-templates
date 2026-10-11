import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Client } from 'pg';
import type * as BcryptModule from 'bcrypt';
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
 */

const TEST_DB = 'brute_force_e2e';
const SEED_PASSWORD = 'seed-test-password-123';
const TEST_JWT_SECRET = 'brute-force-e2e-signing-secret-key-for-tests-012345';
const PROOF_TIMEOUT = 600_000;

const DELAY_SCHEDULE_SECONDS = '0,1,2,4';
const WINDOW = '600';

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

    const clear = await loginFrom({ username, password: 'wrong' }, '10.9.0.1');
    expect(clear.statusCode).toBe(401);
    // k=0 on this request (no counted failures yet): it is not delayed.
    const t0 = Date.now();
    await loginFrom({ username, password: 'wrong' }, '10.9.0.2'); // k=1 → schedule[1] = 1s
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);

    const t1 = Date.now();
    await loginFrom({ username, password: 'wrong' }, '10.9.0.3'); // k=2 → schedule[2] = 2s
    expect(Date.now() - t1).toBeGreaterThanOrEqual(2000);

    const t2 = Date.now();
    await loginFrom({ username, password: 'wrong' }, '10.9.0.4'); // k=3 → schedule[3] = 4s
    expect(Date.now() - t2).toBeGreaterThanOrEqual(4000);
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

    const t0 = Date.now();
    await loginFrom({ username: 'rotation-other', password: 'wrong' }, '::ffff:1.2.3.4');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4000);

    const t1 = Date.now();
    await loginFrom({ username: 'rotation-other-2', password: 'wrong' }, '1.2.3.4');
    expect(Date.now() - t1).toBeGreaterThanOrEqual(4000);
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

    const t0 = Date.now();
    await loginFrom({ username: 'subnet-insider', password: 'wrong' }, '2001:db8:aa:bb::9');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2000);

    const t1 = Date.now();
    await loginFrom({ username: 'subnet-outsider', password: 'wrong' }, '2001:db8:cc:dd::1');
    expect(Date.now() - t1).toBeLessThan(1000);
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
    const t0 = Date.now();
    const allowlisted = await loginFrom({ username, password: 'wrong' }, '203.0.113.7');
    expect(allowlisted.statusCode).toBe(401);
    expect(Date.now() - t0).toBeLessThan(1000);
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
    const t0 = Date.now();
    const success = await loginFrom({ username, password: SEED_PASSWORD }, '7.7.7.7');
    expect(success.statusCode).toBe(200);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2000);

    const body = success.json<{ accessToken: string }>();
    expect(body.accessToken).toBeTruthy();

    // The success row reset the counters: the next attempt is unthrottled.
    const t1 = Date.now();
    const after = await loginFrom({ username, password: 'wrong' }, '7.7.7.7');
    expect(after.statusCode).toBe(401);
    expect(Date.now() - t1).toBeLessThan(1000);
  });

});
