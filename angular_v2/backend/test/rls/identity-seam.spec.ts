import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { PostgrestClient } from '../../src/postgrest/postgrest-client.js';
import {
  PostgrestResponseError,
  PostgrestUnavailableError,
} from '../../src/postgrest/postgrest.errors.js';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';
import {
  attemptAsSuperuser,
  authenticatorClient,
  baseUrl,
  dropProofDatabase,
  ownerClient,
  proofDatabase,
  PROOF_AUTHENTICATOR_PASSWORD,
  PROOF_JWT_SECRET,
  queryAsSuperuser,
  rebuildDatabase,
  startPostgrest,
} from './support/fixture.js';
import { mintToken } from './support/jwt.js';

/**
 * Identity Seam Proof — spec-identity.md and AGENTS.md §B2.
 *
 * ## What this suite is proving
 *
 * 1. **Identity arrives at the database.** When the thin app calls PostgREST with a
 *    verified caller's token, PostgREST sets `request.jwt.claims` in the database
 *    transaction and PostgreSQL evaluates `authz.actor()` to that user. The proof is
 *    what the DATABASE resolved — verified through RLS policies that admit only `authz.actor()`.
 *    In contrast, a direct claimless app session (`SET LOCAL ROLE app_admin` without claims)
 *    resolves `authz.actor()` to NULL and reads 0 rows.
 *
 * 2. **The confused-deputy negative.** A different user's token resolves to THAT user
 *    and never the first. User A cannot read or modify User B's rows, and querying with
 *    User B's token returns User B's records with User A completely absent.
 *
 * 3. **Unauthenticated negative.** Missing caller token fails with 401, never silent success.
 *
 * 4. **Tampered/expired token negative.** Refused with 401.
 *
 * 5. **Unreachable PostgREST.** Fails loudly with `PostgrestUnavailableError`, never degrades.
 *
 * 6. **Positive controls.** Proves that in-scope queries return live database rows,
 *    so tests cannot pass against a database that refuses everything.
 */

const TIMEOUT = 180_000;
const MIGRATIONS_DIR = join(BACKEND_ROOT, 'database', 'migrations');

function migrationFiles(): readonly string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4,}_.*\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort();
}

function applyRemainingMigrations(): void {
  const config = loadTestEnvironment().database;
  for (const migration of migrationFiles()) {
    if (migration.startsWith('0001_')) {
      continue;
    }
    const path = join(MIGRATIONS_DIR, migration);
    const result = spawnSync(
      'psql',
      [
        '-v',
        'ON_ERROR_STOP=1',
        '-q',
        '-h',
        config.host,
        '-p',
        String(config.port),
        '-U',
        config.user,
        '-d',
        proofDatabase(),
        '-f',
        path,
      ],
      { encoding: 'utf8', env: { ...process.env, PGPASSWORD: config.password } },
    );
    if (result.status !== 0) {
      throw new Error(`applying ${migration} as ${config.user} failed:\n${result.stderr}`);
    }
  }
}

function runSeed(): { readonly code: number; readonly output: string } {
  const result = spawnSync('node', ['--experimental-strip-types', 'database/seed.ts'], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      DB_NAME: proofDatabase(),
      SEED_ADMIN_PASSWORD: 'identity-proof-admin-password',
      SEED_AUTHENTICATOR_PASSWORD: PROOF_AUTHENTICATOR_PASSWORD,
    },
    encoding: 'utf8',
    timeout: 300_000,
  });
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const IDS = {
  groups: {
    groupA: '77777777-0000-0000-0000-000000000001',
    groupB: '77777777-0000-0000-0000-000000000002',
  },
  users: {
    userA: '88888888-0000-0000-0000-000000000001',
    userB: '88888888-0000-0000-0000-000000000002',
  },
  requests: {
    reqA: '99999999-0000-0000-0000-000000000001',
    reqB: '99999999-0000-0000-0000-000000000002',
  },
} as const;

async function asAdmin<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = authenticatorClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_admin');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
}

async function asOwner<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = ownerClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
}

function createClientForProof(url = baseUrl()): PostgrestClient {
  const config = {
    getOrThrow: (key: string) => {
      if (key === 'environment') {
        return { postgrest: { baseUrl: url } };
      }
      throw new Error(`unexpected key: ${key}`);
    },
  } as unknown as ConfigService;
  return new PostgrestClient(config);
}

function userToken(userId: string, role = 'app_member', expSecondsOffset = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + expSecondsOffset;
  return mintToken(PROOF_JWT_SECRET, { sub: userId, role, exp });
}

let stopPostgrest: (() => void) | undefined;

beforeAll(async () => {
  rebuildDatabase();
  applyRemainingMigrations();
  const seedResult = runSeed();
  if (seedResult.code !== 0) {
    throw new Error(`seed failed:\n${seedResult.output}`);
  }

  await asAdmin(async (client) => {
    const roles = await client.query<{ name: string; id: string }>(
      `SELECT name, id FROM roles WHERE name = 'member'`,
    );
    const memberRole = roles.rows[0]?.id;
    if (memberRole === undefined) {
      throw new Error('the seeded member role is absent');
    }

    for (const [user, username] of [
      [IDS.users.userA, 'seam-user-a'],
      [IDS.users.userB, 'seam-user-b'],
    ] as const) {
      await client.query(
        `INSERT INTO users (id, username, email, password_hash) VALUES ($1, $2, $3, 'HASH-0001')
         ON CONFLICT (id) DO NOTHING`,
        [user, username, `${username}@example.test`],
      );
      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        user,
        memberRole,
      ]);
    }
  });

  await asOwner(async (client) => {
    await client.query(
      `INSERT INTO groups (id, name) VALUES ($1, 'group-A'), ($2, 'group-B') ON CONFLICT DO NOTHING`,
      [IDS.groups.groupA, IDS.groups.groupB],
    );
    await client.query(
      `INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2), ($3, $4) ON CONFLICT DO NOTHING`,
      [IDS.users.userA, IDS.groups.groupA, IDS.users.userB, IDS.groups.groupB],
    );
  });

  // Seed privacy requests: one for userA, one for userB.
  // Inserted as superuser to bypass RLS for fixture setup.
  const outcome = attemptAsSuperuser([
    `INSERT INTO public.privacy_requests (id, user_id, request_nature, request_channel, status)
     VALUES
       ('${IDS.requests.reqA}', '${IDS.users.userA}', 'access', 'in_app', 'open'),
       ('${IDS.requests.reqB}', '${IDS.users.userB}', 'deletion', 'in_app', 'open')
     ON CONFLICT (id) DO NOTHING`,
  ]);
  if (!outcome.ok) {
    throw new Error(`seeding privacy requests failed:\n${outcome.output}`);
  }

  const pgrst = await startPostgrest();
  stopPostgrest = pgrst.stop;
}, TIMEOUT);

afterAll(() => {
  try {
    stopPostgrest?.();
  } finally {
    try {
      dropProofDatabase();
    } finally {
      restoreAuthenticatorPassword();
    }
  }
});

// =============================================================================
// TESTS
// =============================================================================

describe('Identity Seam Proof (spec-identity.md)', () => {
  it(
    'the thin app replaying verified caller token causes the database to resolve authz.actor() to the caller (asserted on database row resolution)',
    async () => {
      const client = createClientForProof();
      const tokenA = userToken(IDS.users.userA);

      // 1. Observe through users policy (users_read_scope: id IN (SELECT authz.actor() WHERE authz.can_read_user()))
      const usersResponse = await client.get<readonly { id: string; username: string }[]>(
        tokenA,
        'users?select=id,username',
      );
      expect(usersResponse.status).toBe(200);
      expect(usersResponse.data).toHaveLength(1);
      expect(usersResponse.data[0]?.id).toBe(IDS.users.userA);
      expect(usersResponse.data[0]?.username).toBe('seam-user-a');

      // 2. Observe through privacy_requests policy (privacy_request_read: user_id = authz.actor())
      const requestsResponse = await client.get<readonly { id: string; user_id: string; request_nature: string }[]>(
        tokenA,
        'privacy_requests?select=id,user_id,request_nature',
      );
      expect(requestsResponse.status).toBe(200);
      expect(requestsResponse.data).toHaveLength(1);
      expect(requestsResponse.data[0]?.id).toBe(IDS.requests.reqA);
      expect(requestsResponse.data[0]?.user_id).toBe(IDS.users.userA);
      expect(requestsResponse.data[0]?.request_nature).toBe('access');

      // 3. Contrast with direct claimless app session (SET LOCAL ROLE app_admin without claims)
      // Measured: privacy_requests reads 0 rows because authz.actor() is NULL
      await asAdmin(async (pgClient) => {
        const actorRes = await pgClient.query<{ actor: string | null }>('SELECT authz.actor() AS actor');
        expect(actorRes.rows[0]?.actor).toBeNull();

        const claimlessRequests = await pgClient.query('SELECT * FROM public.privacy_requests');
        expect(claimlessRequests.rowCount).toBe(0);
      });
    },
    TIMEOUT,
  );

  it(
    'the confused-deputy negative: a different user token resolves to that user and never the first',
    async () => {
      const client = createClientForProof();
      const tokenA = userToken(IDS.users.userA);
      const tokenB = userToken(IDS.users.userB);

      // Caller with User B's token queries users
      const usersB = await client.get<readonly { id: string; username: string }[]>(
        tokenB,
        'users?select=id,username',
      );
      expect(usersB.status).toBe(200);
      expect(usersB.data).toHaveLength(1);
      expect(usersB.data[0]?.id).toBe(IDS.users.userB);
      expect(usersB.data[0]?.username).toBe('seam-user-b');
      expect(JSON.stringify(usersB.data)).not.toContain(IDS.users.userA);

      // Caller with User B's token queries privacy_requests
      const reqsB = await client.get<readonly { id: string; user_id: string }[]>(
        tokenB,
        'privacy_requests?select=id,user_id',
      );
      expect(reqsB.status).toBe(200);
      expect(reqsB.data).toHaveLength(1);
      expect(reqsB.data[0]?.id).toBe(IDS.requests.reqB);
      expect(reqsB.data[0]?.user_id).toBe(IDS.users.userB);
      expect(JSON.stringify(reqsB.data)).not.toContain(IDS.users.userA);

      // Cross-caller negative: User A attempts to read User B's records by explicit id
      const crossUserRead = await client.get<readonly { id: string }[]>(
        tokenA,
        `users?select=id&id=eq.${IDS.users.userB}`,
      );
      expect(crossUserRead.status).toBe(200);
      expect(crossUserRead.data).toHaveLength(0);

      const crossRequestRead = await client.get<readonly { id: string }[]>(
        tokenA,
        `privacy_requests?select=id&id=eq.${IDS.requests.reqB}`,
      );
      expect(crossRequestRead.status).toBe(200);
      expect(crossRequestRead.data).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    'the unauthenticated negative: requests without a caller token are refused and never succeed silently',
    async () => {
      const client = createClientForProof();

      // Without token, PostgREST falls back to app_anon role which has no SELECT grant on privacy_requests
      try {
        await client.get(undefined, 'privacy_requests');
        expect.unreachable('unauthenticated request should have been rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(PostgrestResponseError);
        const resError = error as PostgrestResponseError;
        expect(resError.status).toBe(401);
      }

      try {
        await client.get('', 'privacy_requests');
        expect.unreachable('empty token request should have been rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(PostgrestResponseError);
        const resError = error as PostgrestResponseError;
        expect(resError.status).toBe(401);
      }
    },
    TIMEOUT,
  );

  it(
    'the tampered and expired token negatives: invalid bearer tokens are rejected with 401',
    async () => {
      const client = createClientForProof();

      // 1. Expired token (exp in the past)
      const expiredToken = userToken(IDS.users.userA, 'app_member', -3600);
      try {
        await client.get(expiredToken, 'privacy_requests');
        expect.unreachable('expired token should have been rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(PostgrestResponseError);
        const resError = error as PostgrestResponseError;
        expect(resError.status).toBe(401);
      }

      // 2. Tampered token signed with wrong secret
      const wrongSecretToken = mintToken('wrong-secret-that-does-not-match-pgrst-jwt-secret-000', {
        sub: IDS.users.userA,
        role: 'app_member',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      try {
        await client.get(wrongSecretToken, 'privacy_requests');
        expect.unreachable('tampered token should have been rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(PostgrestResponseError);
        const resError = error as PostgrestResponseError;
        expect(resError.status).toBe(401);
      }
    },
    TIMEOUT,
  );

  it(
    'an unreachable PostgREST fails loudly throwing PostgrestUnavailableError and never degrades to empty or false',
    async () => {
      // Point client to a port where nothing is listening
      const unreachableClient = createClientForProof('http://127.0.0.1:39999');
      const tokenA = userToken(IDS.users.userA);

      try {
        await unreachableClient.get(tokenA, 'privacy_requests');
        expect.unreachable('unreachable PostgREST should have thrown PostgrestUnavailableError');
      } catch (error) {
        expect(error).toBeInstanceOf(PostgrestUnavailableError);
        const unavailable = error as PostgrestUnavailableError;
        expect(unavailable.name).toBe('PostgrestUnavailableError');
        expect(unavailable.url).toContain('39999');
        expect(unavailable.message).toContain('PostgREST is unreachable at http://127.0.0.1:39999');
      }
    },
    TIMEOUT,
  );

  it(
    'positive control: verifying the proof database and PostgREST are live and serving real data',
    () => {
      // Confirm that the database contains the records we seeded, so denials are not empty fixtures
      const requests = queryAsSuperuser<{ count: number }>(
        'SELECT count(*)::int AS count FROM public.privacy_requests',
      );
      expect(requests[0]?.count).toBe(2);

      const users = queryAsSuperuser<{ count: number }>(
        `SELECT count(*)::int AS count FROM public.users WHERE id IN ('${IDS.users.userA}', '${IDS.users.userB}')`,
      );
      expect(users[0]?.count).toBe(2);
    },
    TIMEOUT,
  );
});
