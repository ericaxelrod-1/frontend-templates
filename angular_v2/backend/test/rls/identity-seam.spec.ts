import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Controller, Get, Req } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JwtAuthGuard, type AuthenticatedRequest } from '../../src/auth/jwt-auth.guard.js';
import type { Environment } from '../../src/config/environment.js';
import { PostgrestModule } from '../../src/postgrest/postgrest.module.js';
import { PostgrestClient } from '../../src/postgrest/postgrest-client.js';
import { PostgrestResponseError, PostgrestUnavailableError } from '../../src/postgrest/postgrest.errors.js';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';
import {
  attemptAsSuperuser,
  authenticatorClient,
  baseUrl,
  dropProofDatabase,
  proofDatabase,
  PROOF_AUTHENTICATOR_PASSWORD,
  PROOF_JWT_SECRET,
  queryAsSuperuser,
  rebuildDatabase,
  startPostgrest,
} from './support/fixture.js';
import { mintToken } from './support/jwt.js';

/**
 * The identity seam — spec-identity.md, AGENTS.md §B2 (`authz.actor()`), §2.3.
 *
 * ## The claim under test
 *
 * **A logged-in caller's identity reaches the DATABASE.** PostgREST verifies the JWT
 * and sets `request.jwt.claims` inside its own transaction; every policy then reads
 * identity through `authz.actor()`. This suite proves the seam the thin app uses to
 * get there: replay the caller's already-verified bearer token into PostgREST with
 * `PostgrestClient`.
 *
 * ## What the assertions are on — NOT on an HTTP 200
 *
 * Every positive assertion is on **rows the database chose to return**, and on the
 * `user_id` inside them. `privacy_request_read` (`0010:531-542`) resolves a member's
 * visible set to `{authz.actor()}` and nothing else:
 *
 * ```sql
 * USING (user_id IN (SELECT v.user_id FROM (
 *          SELECT authz.actor() AS user_id
 *          UNION SELECT u.user_id FROM authz.visible_user_ids() u(user_id)) v
 *         WHERE authz.can_read_privacy_request()
 *           AND (v.user_id = authz.actor() OR current_user = 'app_admin')))
 * ```
 *
 * so a returned `user_id` IS the database's resolution of the caller. The suite also
 * reads `authz.actor()` itself over a direct connection to show the NULL it resolves
 * to when no claims are set — `authz` is outside `db-schemas` and is not reachable
 * over HTTP, so the direct read is the only way to see the value itself, and the
 * policy read is the way to see it being *used*.
 *
 * ## Why BOTH callers share ONE group — the load-bearing fixture choice
 *
 * `authz.visible_user_ids()` is every member of the caller's own group closure, so a
 * policy keyed on the GROUP rather than on the actor would pass this suite if the two
 * callers sat in different groups. They are planted in one group on purpose, which
 * removes the group closure as an explanation: caller A can see its group peer B's row
 * the moment the `v.user_id = authz.actor()` conjunct weakens. The positive control
 * asserts the two really ARE peers, because without that a passing denial proves
 * nothing.
 *
 * ## What is deliberately NOT here
 *
 * The erasure flow, which is rewritten in a later task on top of this. Rewiring a
 * working compliance path onto an unproven mechanism is how you break erasure to find
 * out whether the mechanism works.
 *
 * **The seam needs no migration at all** — `0021` is not required and is not applied.
 * PostgREST already sets the claims; that is the entire reason this route was chosen
 * over `SET request.jwt.claims` from the app (an ordinary caller-writable GUC, §B2
 * F1, so a self-check resting on it is self-certified) and over an
 * `app_admin = current_user` branch in a read policy (measured: the complete DSAR
 * workload, 7 of 7 requests, every group).
 */

const TIMEOUT = 300_000;

const GROUP_ID = '66666666-0000-0000-0000-0000000000aa';
const USER_A = '88888888-0000-0000-0000-0000000000a1';
const USER_B = '88888888-0000-0000-0000-0000000000b2';
const REQUEST_A = '99999999-0000-0000-0000-0000000000a1';
const REQUEST_B = '99999999-0000-0000-0000-0000000000b2';

interface RequestRow {
  readonly id: string;
  readonly user_id: string;
  readonly status: string;
}

/**
 * The thin app's account-scoped route, standing in for the ones that will consume
 * the seam.
 *
 * It does the one thing the seam is: hand PostgREST the bearer token the GUARD
 * verified. `req.token` is set by `JwtAuthGuard` at `jwt-auth.guard.ts:77` and is
 * the verified string, so this controller never re-parses the header and the token
 * the database sees is by construction the token the app authenticated.
 */
@Controller('seam')
class SeamProofController {
  constructor(private readonly postgrest: PostgrestClient) {}

  @Get('resolved-actor')
  async resolvedActor(@Req() req: AuthenticatedRequest): Promise<{ readonly rows: readonly RequestRow[] }> {
    const response = await this.postgrest.get<readonly RequestRow[]>(req.token, 'privacy_requests', {
      params: { select: 'id,user_id,status', order: 'id' },
    });
    return { rows: response.data };
  }
}


/**
 * The REAL provision path: `database/seed.ts` runs bootstrap → `scripts/migrate.ts`
 * → reference data, in that order.
 *
 * This suite deliberately does NOT apply the migrations itself. `rebuildDatabase()`
 * has already applied `0001_rls_foundation.sql` (twice, because the fixture holds it
 * to being idempotent), and `migrate.ts` owns the `migrations` table, so hand-feeding
 * the files through `psql` first would make the migrator re-apply schema the
 * database already has. Provisioning the way a deployment does is both shorter and
 * the only way the seeded capability axis is genuine — `member` holds
 * `privacy_request:read` because the seed grants it, not because this file said so.
 */
function runSeed(): void {
  const result = spawnSync('node', ['--experimental-strip-types', 'database/seed.ts'], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      DB_NAME: proofDatabase(),
      SEED_ADMIN_PASSWORD: 'seam-proof-admin-password',
      SEED_AUTHENTICATOR_PASSWORD: PROOF_AUTHENTICATOR_PASSWORD,
    },
    encoding: 'utf8',
    timeout: TIMEOUT,
  });
  if (result.status !== 0) {
    throw new Error(`seed failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
}

/** Plants the fixture: one group, two members of it, one open request each. */
function plantFixture(): void {
  const memberRole = queryAsSuperuser<{ id: string }>(
    `SELECT id FROM public.roles WHERE name = 'member'`,
  )[0]?.id;
  if (memberRole === undefined) {
    throw new Error('the seeded member role is absent, so no fixture user holds a capability');
  }

  const outcome = attemptAsSuperuser([
    `INSERT INTO public.groups (id, name) VALUES ('${GROUP_ID}', 'seam-shared-group')`,
    `INSERT INTO public.users (id, username, email, password_hash) VALUES
       ('${USER_A}', 'seam-alice', 'seam-alice@example.test', 'HASH-0001'),
       ('${USER_B}', 'seam-bob',   'seam-bob@example.test',   'HASH-0001')`,
    `INSERT INTO public.user_groups (user_id, group_id)
       VALUES ('${USER_A}', '${GROUP_ID}'), ('${USER_B}', '${GROUP_ID}')`,
    `INSERT INTO public.user_roles (user_id, role_id)
       VALUES ('${USER_A}', '${memberRole}'), ('${USER_B}', '${memberRole}')`,
    `INSERT INTO public.privacy_requests (id, user_id, request_nature, request_channel, status) VALUES
       ('${REQUEST_A}', '${USER_A}', 'access',   'in_app', 'open'),
       ('${REQUEST_B}', '${USER_B}', 'deletion', 'in_app', 'open')`,
  ]);
  if (!outcome.ok) {
    throw new Error(`planting the seam fixture failed:\n${outcome.output}`);
  }
}

/**
 * The environment the thin app runs with.
 *
 * Built from the REAL `loadEnvironment` over `.env.test`, with exactly two values
 * replaced: the PostgREST base URL and the JWT secret. Both are forced by the
 * fixture's isolation — `startPostgrest()` serves on its own port with its own secret,
 * and it is that same secret the guard verifies with, which is the seam's whole
 * premise (one machine, one secret, no trust boundary crossed). Nothing else is
 * touched, so the configuration path exercised here is the production one and a
 * mis-shaped `POSTGREST_URL` would still throw at load.
 */
function proofEnvironment(): Environment {
  const loaded = loadTestEnvironment();
  return {
    ...loaded,
    jwt: { ...loaded.jwt, secret: PROOF_JWT_SECRET },
    postgrest: { baseUrl: baseUrl() },
  };
}

interface ThinApp {
  readonly app: NestFastifyApplication;
  /** The real client, resolved out of the real DI container. */
  readonly client: PostgrestClient;
  readonly close: () => Promise<void>;
}

async function bootThinApp(environment: Environment): Promise<ThinApp> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ load: [() => ({ environment })] }),
      JwtModule.register({}),
      PostgrestModule,
    ],
    controllers: [SeamProofController],
    // The REAL global guard, registered the way `app.module.ts` registers it: a route
    // that forgets the guard is fully public, so the proof route gets the same
    // default-deny treatment as production.
    providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    client: moduleRef.get(PostgrestClient),
    close: async () => {
      await app.close();
      await moduleRef.close();
    },
  };
}

/**
 * A port that was bound and released, so "nothing is listening there" is established
 * rather than assumed (`AGENTS.md` §B8: never let a test assume a port is free).
 */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

function callerToken(sub: string, expOffsetSeconds = 3600): string {
  return mintToken(PROOF_JWT_SECRET, {
    sub,
    role: 'app_member',
    exp: Math.floor(Date.now() / 1000) + expOffsetSeconds,
  });
}

/** A claimless `app_admin` session — the thin app's own default, and the "before". */
async function claimlessAdmin<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = authenticatorClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_admin');
    return await work(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

let stopPostgrest: (() => void) | undefined;
let thin: ThinApp | undefined;

/**
 * The booted thin app, or a loud failure. `beforeAll` always runs before any test, so
 * this never fires — it exists so the type of the suite's subject is `ThinApp` rather
 * than `ThinApp | undefined`, and so a future test cannot silently assert against
 * nothing.
 */
function theApp(): ThinApp {
  if (thin === undefined) {
    throw new Error('the thin app was never booted, so this suite has no subject');
  }
  return thin;
}

beforeAll(async () => {
  rebuildDatabase();
  runSeed();
  plantFixture();
  const running = await startPostgrest();
  stopPostgrest = running.stop;
  thin = await bootThinApp(proofEnvironment());
}, TIMEOUT);

afterAll(async () => {
  try {
    await thin?.close();
  } finally {
    try {
      stopPostgrest?.();
    } finally {
      try {
        dropProofDatabase();
      } finally {
        restoreAuthenticatorPassword();
      }
    }
  }
});

describe('the identity seam: a caller identity reaches the database', () => {
  it(
    'an authenticated request through the thin app makes the DATABASE resolve authz.actor() to that caller',
    async () => {
      const response = await theApp().app.inject({
        method: 'GET',
        url: '/seam/resolved-actor',
        headers: { authorization: `Bearer ${callerToken(USER_A)}` },
      });

      expect(response?.statusCode).toBe(200);
      const rows = response?.json<{ rows: readonly RequestRow[] }>().rows ?? [];

      // The database resolved the actor to A and admitted exactly A's row.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(REQUEST_A);
      expect(rows[0]?.user_id).toBe(USER_A);
    },
    TIMEOUT,
  );

  it(
    'a claimless app_admin session resolves authz.actor() to NULL and reads zero rows, so the seam is what supplies identity',
    async () => {
      const observed = await claimlessAdmin(async (client) => {
        const actor = await client.query<{ actor: string | null }>('SELECT authz.actor() AS actor');
        const visible = await client.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM authz.visible_user_ids()',
        );
        const requests = await client.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM public.privacy_requests',
        );
        return {
          actor: actor.rows[0]?.actor ?? null,
          visible: visible.rows[0]?.count ?? -1,
          requests: requests.rows[0]?.count ?? -1,
        };
      });

      expect(observed.actor).toBeNull();
      expect(observed.visible).toBe(0);
      expect(observed.requests).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'a DIFFERENT caller token resolves to that caller and never to the first: the seam is not a confused deputy',
    async () => {
      const response = await theApp().app.inject({
        method: 'GET',
        url: '/seam/resolved-actor',
        headers: { authorization: `Bearer ${callerToken(USER_B)}` },
      });

      expect(response?.statusCode).toBe(200);
      const rows = response?.json<{ rows: readonly RequestRow[] }>().rows ?? [];

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(REQUEST_B);
      expect(rows[0]?.user_id).toBe(USER_B);

      // Not merely "B's row came back" — A's identity is absent from the payload.
      const serialised = JSON.stringify(rows);
      expect(serialised).not.toContain(USER_A);
      expect(serialised).not.toContain(REQUEST_A);
    },
    TIMEOUT,
  );

  it(
    "a caller naming another caller's request by primary key gets nothing, even though the two are group peers",
    async () => {
      const named = await theApp().client.get<readonly RequestRow[]>(callerToken(USER_A), 'privacy_requests', {
        params: { select: 'id,user_id', id: `eq.${REQUEST_B}` },
      });
      expect(named.data).toHaveLength(0);

      // The control: the same filter with B's OWN token returns the row, so the empty
      // result above is the policy refusing a peer and not a filter that matches
      // nothing for either caller.
      const own = await theApp().client.get<readonly RequestRow[]>(callerToken(USER_B), 'privacy_requests', {
        params: { select: 'id,user_id', id: `eq.${REQUEST_B}` },
      });
      expect(own.data).toHaveLength(1);
      expect(own.data[0]?.user_id).toBe(USER_B);
    },
    TIMEOUT,
  );

  it(
    'a request with no caller identity is refused, not served as an empty success',
    async () => {
      const anonymous = await theApp().app.inject({ method: 'GET', url: '/seam/resolved-actor' });
      expect(anonymous?.statusCode).toBe(401);
      expect(anonymous?.json()).toEqual({
        statusCode: 401,
        message: 'unauthorized',
        error: 'Unauthorized',
      });

      // And at the seam itself: no token means PostgREST falls back to `app_anon`,
      // which holds no SELECT on `privacy_requests`. A denial, never `[]`.
      await expect(
        theApp().client.get(undefined, 'privacy_requests', { params: { select: 'id' } }),
      ).rejects.toSatisfy(
        (error: unknown): boolean =>
          error instanceof PostgrestResponseError && error.status === 401,
      );
    },
    TIMEOUT,
  );

  it(
    'an expired, malformed or wrongly-signed token never reaches the database',
    async () => {
      const wrongSecret = mintToken('a-secret-that-is-not-the-proof-signing-key-00', {
        sub: USER_A,
        role: 'app_member',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const variants: ReadonlyArray<readonly [string, string]> = [
        ['expired', callerToken(USER_A, -3600)],
        ['wrongly-signed', wrongSecret],
        ['malformed', 'not-a-jwt-at-all'],
      ];

      for (const [name, token] of variants) {
        const response = await theApp().app.inject({
          method: 'GET',
          url: '/seam/resolved-actor',
          headers: { authorization: `Bearer ${token}` },
        });
        expect(`${name} → ${response?.statusCode}`).toBe(`${name} → 401`);
      }

      // The positive control inside this test: the SAME route with a well-formed token
      // succeeds, so those three 401s are refusals and not a route that refuses
      // everything (AGENTS.md §B8).
      const allowed = await theApp().app.inject({
        method: 'GET',
        url: '/seam/resolved-actor',
        headers: { authorization: `Bearer ${callerToken(USER_A)}` },
      });
      expect(allowed?.statusCode).toBe(200);
      expect(allowed?.json<{ rows: readonly RequestRow[] }>().rows).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'an unreachable PostgREST fails loudly and never degrades into an empty success',
    async () => {
      const port = await closedPort();
      const outageEnvironment: Environment = {
        ...proofEnvironment(),
        postgrest: { baseUrl: `http://127.0.0.1:${port}` },
      };

      await expect(
        (await bootThinApp(outageEnvironment)).client.get(callerToken(USER_A), 'privacy_requests', {
          params: { select: 'id' },
        }),
      ).rejects.toBeInstanceOf(PostgrestUnavailableError);

      // Through the thin app the same outage must surface as a FAILURE. An
      // unreachable database layer answering 200 with `rows: []` would tell erasure
      // the subject has nothing open when nothing was ever asked (§2.3).
      const outage = await bootThinApp(outageEnvironment);
      try {
        const response = await outage.app.inject({
          method: 'GET',
          url: '/seam/resolved-actor',
          headers: { authorization: `Bearer ${callerToken(USER_A)}` },
        });
        expect(response?.statusCode).toBeGreaterThanOrEqual(500);
        expect(response?.body).not.toContain('"rows"');
      } finally {
        await outage.close();
      }
    },
    TIMEOUT,
  );

  it(
    'positive control: the fixture is populated, both callers are group peers, and the capability the policy requires exists',
    () => {
      const requests = queryAsSuperuser<{ count: number }>(
        'SELECT count(*)::int AS count FROM public.privacy_requests',
      );
      expect(requests[0]?.count).toBe(2);

      const peers = queryAsSuperuser<{ count: number }>(
        `SELECT count(*)::int AS count FROM public.user_groups
          WHERE group_id = '${GROUP_ID}' AND user_id IN ('${USER_A}', '${USER_B}')`,
      );
      expect(peers[0]?.count).toBe(2);

      // The `member` role must really hold the capability `privacy_request_read`
      // requires, or a denial above would be indistinguishable from an empty fixture.
      const capability = queryAsSuperuser<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name = 'member' AND p.resource = 'privacy_request' AND p.action_id = 'read'`,
      );
      expect(capability[0]?.count).toBe(1);
    },
    TIMEOUT,
  );
});