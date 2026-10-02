import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseConfig } from '../support/database.js';
import {
  applyMigrationAsOwner,
  authenticatorClient,
  baseUrl,
  queryAsSuperuser,
  OWNING_ROLE,
  PROOF_JWT_SECRET,
  rebuildDatabase,
  seed,
  SERVING_ROLES,
  startPostgrest,
  type Sites,
} from './support/fixture.js';
import { mintToken, parseJsonArray, request } from './support/jwt.js';

/**
 * W07 — proof that PostgreSQL row-level security does what the documentation
 * claims.
 *
 * Every test names the attack it prevents, because the value of this suite in six
 * months is that a reader can see which claim is load-bearing. A test called
 * "policies work" tells a future maintainer nothing; a test called "a token
 * naming the table-owning role is refused" tells them what breaks if it fails.
 *
 * The suite asserts on bodies and row counts, never on status codes alone. A
 * status-only assertion passes on a real leak: an unauthenticated read and a
 * successful read can both be `200`.
 *
 * If the database or PostgREST is unreachable, `beforeAll` throws and the suite
 * FAILS. There is no skip path. A security suite that passes without exercising
 * its subject is a false green.
 */

const TIMEOUT = 120_000;

let client: Client;
let sites: Sites;
let stopPostgrest: () => void;

/**
 * Row count that sees every row, used to prove nothing was read, written or
 * deleted by a request.
 *
 * Not the owner: under FORCE the owner is bound by its own policy, so a claimless
 * owner read returns 0 rows rather than the true count (verified). A count taken
 * through a filtered path cannot distinguish "nothing was deleted" from "I can
 * see nothing", which would make every denial assertion in this suite vacuous.
 */
function trueCustomerCount(): number {
  const rows = queryAsSuperuser<{ count: number }>('SELECT count(*)::int AS count FROM customers');
  const row = rows[0];
  if (row === undefined) {
    throw new Error('counting customers returned no row');
  }
  return row.count;
}

/**
 * Row names a caller can see. A PostgREST error body is a failure of this helper,
 * not an empty result: an error and a denial must never look alike, because "no
 * rows" is the outcome a leak would have to beat.
 */
async function visibleCustomerNames(token: string): Promise<readonly string[]> {
  const response = await request(`${baseUrl()}/customers?select=name`, token);
  return parseJsonArray(response.body).map((row) => String(row['name']));
}

beforeAll(async () => {
  rebuildDatabase();

  client = new Client({ ...databaseConfig(), database: 'rls_proof' });
  await client.connect();

  // The seeder connects as the one role allowed to receive a request and assumes
  // app_admin, because the owner role is bound by FORCE and cannot write at all.
  const seeder = authenticatorClient();
  await seeder.connect();
  try {
    sites = await seed({ client: seeder });
  } finally {
    await seeder.end();
  }

  const running = await startPostgrest();
  stopPostgrest = running.stop;
}, TIMEOUT);

afterAll(async () => {
  stopPostgrest?.();
  await client?.end();
});

describe('W07 · escalation: the role claim is an attack surface, and the grant is the only boundary', () => {
  it(
    'a validly-signed token naming the table-owning role is refused, and reads nothing',
    async () => {
      // The confirmed live exploit. PostgREST issues SET ROLE for whatever the
      // token names, so an attacker who can get a token minted — or who signs
      // one with a leaked secret — names the role that owns the table and reads
      // every row. The owner is exempt from its own RLS policies, so this is a
      // total bypass, not a widening.
      const escalation = mintToken(PROOF_JWT_SECRET, { role: OWNING_ROLE });

      const before = trueCustomerCount();
      expect(before).toBeGreaterThan(0);

      const read = await request(`${baseUrl()}/customers?select=id,name,internal_notes`, escalation);

      // Postgres refuses the SET ROLE outright — verified message:
      // `permission denied to set role "app"`. Asserting the message is what
      // makes this a test of the GRANT rather than of a coincidental 403: any
      // other 403 on this path would mean a different control had fired.
      expect(read.status, `escalation body was: ${read.body}`).toBe(403);
      expect(read.body).toContain('permission denied to set role');
      expect(read.body).not.toContain('SECRET-');
    },
    TIMEOUT,
  );

  it(
    'a validly-signed token naming the table-owning role cannot delete, and the row survives',
    async () => {
      // The other half of the confirmed exploit: the escalation token's DELETE
      // returned 204 and removed the row. Asserting the count is the only way to
      // prove that; a 403 alone would not survive a future regression that
      // returned a different error after a successful write.
      const escalation = mintToken(PROOF_JWT_SECRET, { role: OWNING_ROLE });
      const before = trueCustomerCount();

      const remove = await request(`${baseUrl()}/customers`, escalation, { method: 'DELETE' });

      expect(remove.status).toBe(403);
      expect(trueCustomerCount()).toBe(before);
    },
    TIMEOUT,
  );

  it(
    'every role other than the three granted ones is refused, including the migrator',
    async () => {
      // A denylist would pass the single escalation case above and fail here. The
      // control is an allowlist, so the assertion is over the whole cluster: any
      // role not named in the GRANT must be unreachable.
      const refused = await client.query<{ rolname: string }>(
        `SELECT rolname FROM pg_roles
          WHERE rolcanlogin OR rolname LIKE 'app\\_%'
          ORDER BY rolname`,
      );

      const granted = new Set<string>(['app_anon', 'app_member', 'app_admin']);
      const candidates = refused.rows.map((row) => row.rolname).filter((name) => !granted.has(name));
      expect(candidates.length).toBeGreaterThan(0);

      for (const role of candidates) {
        const token = mintToken(PROOF_JWT_SECRET, { role });
        const response = await request(`${baseUrl()}/customers?select=id`, token);
        expect(response.status, `role ${role} was not refused`).toBe(403);
      }
    },
    TIMEOUT,
  );

  it(
    'an admin token that forges the admin claim without the admin role still sees nothing',
    async () => {
      // The policies read `current_user`, which Postgres sets from the SET ROLE
      // that the escalation boundary already constrained — not from the token.
      // If an admin check were written against the claim instead, a member could
      // promote themselves by editing one JSON field of a validly-signed token.
      const forged = mintToken(PROOF_JWT_SECRET, {
        role: 'app_member',
        site_id: sites.unrelated,
      });
      const genuinelyAdmin = mintToken(PROOF_JWT_SECRET, { role: 'app_admin' });

      // The forged claim is the member's own site, so it must see exactly that
      // one row and no more — never the whole table.
      expect(await visibleCustomerNames(forged)).toHaveLength(1);
      expect(await visibleCustomerNames(genuinelyAdmin)).toHaveLength(trueCustomerCount());
    },
    TIMEOUT,
  );

  it(
    'an anonymous request is refused with an empty body, not an error',
    async () => {
      // An absent claim must not fall through to a permissive branch. PostgREST
      // falls back to db-anon-role here, which holds no table grant at all.
      //
      // Asserted as a DENIAL rather than an error, and that distinction is the
      // point: an earlier correction granted EXECUTE on the policy helpers to
      // app_member and app_admin but not app_anon, so this exact request returned
      // `permission denied for function site_tree_ids`. A policy that errors is a
      // denial-of-service surface and tells an attacker the policy exists.
      const anonymous = await request(`${baseUrl()}/customers?select=id`);

      // PostgREST answers a no-grant table with 401 and a 42501 body — verified,
      // and the body is an error object rather than an empty array. What matters
      // is that it carries no data and no POLICY error: "permission denied for
      // table" is the grant layer answering, while "permission denied for
      // function" would mean the policy itself could not be evaluated. Only the
      // second is a denial-of-service surface and an oracle.
      expect(anonymous.status).toBe(401);
      expect(anonymous.body).not.toContain('SECRET-');
      expect(anonymous.body.includes('permission denied for function')).toBe(false);
      expect(anonymous.body).toContain('permission denied for table');

      // The same must hold for the table whose policy walks the tree.
      const anonymousSites = await request(`${baseUrl()}/sites?select=id`);
      expect(anonymousSites.body.includes('permission denied for function')).toBe(false);
    },
    TIMEOUT,
  );
});

describe('W07 · scope: an app_member token sees only its own site', () => {
  it(
    'the token for site A reads site A rows and none of site B',
    async () => {
      // A LEAF site, deliberately. At a leaf the subtree and the site coincide, so
      // "sees only its own site" is unambiguous and this test cannot pass merely
      // because hierarchy happens to include everything. The hierarchy behaviour
      // is asserted separately, where it is the point rather than a confound.
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.leaf });
      const names = await visibleCustomerNames(token);

      expect(names).toHaveLength(1);
      expect(names[0]).toBe(`customer-${sites.leaf.slice(0, 4)}`);
    },
    TIMEOUT,
  );

  it(
    'the token for site B reads site B rows and none of site A',
    async () => {
      // The denial has to be proven from both directions. A policy that returned
      // everything would pass the first test; one that returned nothing would
      // pass a single-sided check that only ever counted.
      const tokenA = mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.leaf });
      const tokenB = mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.other });

      const namesA = await visibleCustomerNames(tokenA);
      const namesB = await visibleCustomerNames(tokenB);

      expect(namesA).toHaveLength(1);
      expect(namesB).toHaveLength(1);
      expect(namesA).not.toEqual(namesB);
    },
    TIMEOUT,
  );

  it(
    'a member cannot widen its scope by naming a different site in the token',
    async () => {
      // Same claim shape, different site: proves the policy reads the claim
      // rather than caching or trusting the first value it saw.
      const first = await visibleCustomerNames(
        mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.leaf }),
      );
      const second = await visibleCustomerNames(
        mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.other }),
      );

      expect(first).not.toEqual(second);
    },
    TIMEOUT,
  );
});

describe('W07 · hierarchy: scope follows the site tree, not a flat equality', () => {
  it(
    'root sees its whole subtree, mid-level sees less, an unrelated site sees none of it',
    async () => {
      // The case that never compiled. `site_tree_ids()` originally returned
      // SETOF uuid, which Postgres rejects inside a policy expression outright
      // ("set-returning functions are not allowed in policy expressions"), so
      // this assertion has never run against a working policy before now.
      const atRoot = await visibleCustomerNames(
        mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.root }),
      );
      const atMid = await visibleCustomerNames(
        mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.mid }),
      );
      const atUnrelated = await visibleCustomerNames(
        mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.unrelated }),
      );

      // root -> mid -> leaf is 3 sites.
      expect(atRoot).toHaveLength(3);
      // mid -> leaf is 2.
      expect(atMid).toHaveLength(2);
      // The unrelated site is a sibling of root, not an ancestor: it sees its own
      // single row and none of the subtree.
      expect(atUnrelated).toHaveLength(1);
      expect(atUnrelated).not.toContain(`customer-${sites.root.slice(0, 4)}`);
    },
    TIMEOUT,
  );

  it(
    'an admin sees every row, and scope narrows again the moment the role does',
    async () => {
      const admin = await visibleCustomerNames(mintToken(PROOF_JWT_SECRET, { role: 'app_admin' }));
      const member = await visibleCustomerNames(
        mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.root }),
      );

      expect(admin).toHaveLength(5);
      expect(member).toHaveLength(3);
    },
    TIMEOUT,
  );

  it(
    'a site_id that is a well-formed uuid but matches no site yields zero rows',
    async () => {
      // Distinct from a malformed claim: the cast succeeds, the walk is empty.
      // A policy that treated "no match" as "no restriction" would leak here.
      const token = mintToken(PROOF_JWT_SECRET, {
        role: 'app_member',
        site_id: '00000000-0000-0000-0000-00000000dead',
      });

      expect(await visibleCustomerNames(token)).toHaveLength(0);
    },
    TIMEOUT,
  );
});

describe('W07 · operation: verbs are withheld by grants, not by application code', () => {
  it(
    'app_member may SELECT and INSERT',
    async () => {
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.root });
      const before = trueCustomerCount();

      const inserted = await request(`${baseUrl()}/customers`, token, {
        method: 'POST',
        body: JSON.stringify({ site_id: sites.root, name: 'inserted-by-member' }),
      });

      expect(inserted.status).toBe(201);
      expect(trueCustomerCount()).toBe(before + 1);

      // Removed again through the admin path, because app_member holds no DELETE
      // and the hierarchy and column tests below assert exact row counts. Leaving
      // state behind for the next test would make those counts depend on execution
      // order, which is how a suite starts passing for the wrong reason.
      await removeSeededRow('inserted-by-member');
      expect(trueCustomerCount()).toBe(before);
    },
    TIMEOUT,
  );

  it(
    'app_member cannot UPDATE, and the row is byte-for-byte unchanged afterwards',
    async () => {
      // The point of a grant is that it holds with no application code in the
      // path. These four verbs are refused by Postgres, and the row is re-read to
      // prove the refusal was a refusal and not a silent no-op.
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.root });
      const before = readRowAsOwner(sites.root);

      const updated = await request(`${baseUrl()}/customers`, token, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'renamed-by-member' }),
      });

      expect([403, 405]).toContain(updated.status);
      expect(readRowAsOwner(sites.root)).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    'app_member cannot DELETE, and no row is removed',
    async () => {
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.root });
      const before = trueCustomerCount();

      const removed = await request(`${baseUrl()}/customers`, token, { method: 'DELETE' });

      expect([403, 405]).toContain(removed.status);
      expect(trueCustomerCount()).toBe(before);
    },
    TIMEOUT,
  );

  it(
    'app_member cannot PUT, and no row is replaced',
    async () => {
      // PUT is included separately from PATCH because PostgREST answers 405 for a
      // bodyless PUT on a collection. Asserting the exact code would pin an
      // implementation detail; asserting the row survived pins the security
      // property.
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.root });
      const before = readRowAsOwner(sites.root);

      const replaced = await request(`${baseUrl()}/customers`, token, {
        method: 'PUT',
        body: JSON.stringify({ site_id: sites.root, name: 'replaced-by-member' }),
      });

      expect([403, 405]).toContain(replaced.status);
      expect(readRowAsOwner(sites.root)).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    'app_admin holds the verbs app_member does not',
    async () => {
      // The other side of the same grant, so a migration that granted everything
      // to everyone would fail here rather than passing on denials alone.
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_admin' });

      const updated = await request(`${baseUrl()}/customers`, token, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'renamed-by-admin' }),
      });

      expect(updated.status).toBe(204);
    },
    TIMEOUT,
  );
});

describe('W07 · column hiding: a revoked column is unreadable, not merely omitted', () => {
  it(
    'internal_notes cannot be selected by app_member, and the secret is absent from the body',
    async () => {
      // Asserted on the body, never the status. This is the assertion that a
      // status-only test gets wrong: with a table-level SELECT grant in place the
      // column comes back at HTTP 200 with its value intact, and only the body
      // shows it.
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.root });

      const explicit = await request(`${baseUrl()}/customers?select=internal_notes`, token);

      expect(explicit.status).toBe(403);
      expect(explicit.body).not.toContain('SECRET-');

      // select=* is also refused for a column-restricted role, so the wildcard
      // cannot be used to smuggle the column out.
      const wildcard = await request(`${baseUrl()}/customers?select=*`, token);
      expect(wildcard.status).toBe(403);
      expect(wildcard.body).not.toContain('SECRET-');
    },
    TIMEOUT,
  );

  it(
    'the readable columns still work, so the restriction is a restriction and not a lockout',
    async () => {
      // A test that only proves denial passes just as well against a table nobody
      // can read. This is the permitted case for the same grant.
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', site_id: sites.root });

      const allowed = await request(`${baseUrl()}/customers?select=id,site_id,name`, token);

      expect(allowed.status).toBe(200);
      expect(parseJsonArray(allowed.body)).toHaveLength(3);
    },
    TIMEOUT,
  );

  it(
    'internal_notes is readable by the owner and by nobody with a column-restricted grant',
    async () => {
      // Ground truth for the comparison: the data is really there, so the denial
      // above is a denial and not an empty table. Read unfiltered, because under
      // FORCE a claimless owner read returns zero rows rather than the truth.
      const asOwner = queryAsSuperuser<{ notes: string | null }>(
        'SELECT internal_notes AS notes FROM customers LIMIT 1',
      );
      expect(asOwner[0]?.notes).toMatch(/^SECRET-/);

      for (const role of ['app_anon', 'app_member', 'app_admin'] as const) {
        const readable = await client.query<{ readable: boolean }>(
          `SELECT has_column_privilege($1, 'customers', 'internal_notes', 'SELECT') AS readable`,
          [role],
        );
        expect(readable.rows[0]?.readable, `${role} can read internal_notes`).toBe(false);
      }
    },
    TIMEOUT,
  );
});

describe('W07 · policy totality: a malformed or absent claim denies, and never errors', () => {
  it(
    'empty, absent and empty-object claims all yield zero rows and no error',
    () => {
      // The reason request_claims() exists. A bare
      // current_setting('request.jwt.claims', true)::json RAISES once anything has
      // been SET LOCAL in the session, because the setting reads back as '' and
      // ''::json is not a valid cast. A policy that errors is a 500 on every
      // request, which is both a DoS and an oracle.
      const cases: ReadonlyArray<readonly [string, string | undefined]> = [
        ['never set at all', undefined],
        ['set to the empty string', ''],
        ['set to an empty JSON object', '{}'],
        ['set to a role with no site', '{"role":"app_member"}'],
      ];

      for (const [description, claims] of cases) {
        const names = visibleCustomerNamesAsRole('app_member', claims);
        expect(names, `${description} should deny, not error`).toHaveLength(0);
      }
    },
    TIMEOUT,
  );

  it(
    'a malformed site_id does not break an admin',
    () => {
      // The documented reasoning was that `TRUE OR NULL` saves the admin because
      // the cast on the right never completes. That is wrong: OR does not
      // short-circuit past an expression that raises, and the error wins. The
      // claim_site_id() accessor is what makes this total.
      const names = visibleCustomerNamesAsRole(
        'app_admin',
        '{"role":"app_admin","site_id":"not-a-uuid"}',
      );

      expect(names).toHaveLength(5);
    },
    TIMEOUT,
  );

  it(
    'a malformed site_id denies a member rather than erroring or widening',
    () => {
      const names = visibleCustomerNamesAsRole(
        'app_member',
        '{"role":"app_member","site_id":"not-a-uuid"}',
      );

      expect(names).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    'the policy is total for every claims shape a caller can send, with no query raising',
    () => {
      // The generalisation of the three cases above, run as SQL under each serving
      // role. If any single shape raises, this fails — which is the property the
      // name claims.
      const shapes: readonly string[] = [
        '',
        '{}',
        '[]',
        'null',
        '{"role":"app_member"}',
        '{"role":"app_member","site_id":""}',
        '{"role":"app_member","site_id":null}',
        '{"role":"app_member","site_id":"not-a-uuid"}',
        '{"role":"app_member","site_id":123}',
        '{"role":"app_admin","site_id":"not-a-uuid"}',
        '{"role":"app_admin"}',
        '{"site_id":"not-a-uuid"}',
        'not json at all',
      ];

      for (const role of ['app_member', 'app_admin'] as const) {
        for (const shape of shapes) {
          const names = visibleCustomerNamesAsRole(role, shape);
          expect(names.length, `role ${role} with claims ${shape} did not yield a clean result`).toBeGreaterThanOrEqual(0);
        }
      }
    },
    TIMEOUT,
  );
});

describe('W07 · role attributes: FORCE does not bind a superuser, so the attributes are the control', () => {
  it(
    'every serving role is NOSUPERUSER and NOBYPASSRLS',
    async () => {
      // FORCE ROW LEVEL SECURITY closes the owner hole and nothing else.
      // Verified on a live install: a `postgres` session read 5 of 5 rows from a
      // table that had both ENABLE and FORCE and a working policy. These
      // attributes are therefore the only thing between a serving role and every
      // row, so they are asserted against pg_roles rather than assumed.
      const result = await client.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolname, rolsuper, rolbypassrls
           FROM pg_roles
          WHERE rolname = ANY($1)
          ORDER BY rolname`,
        [[...SERVING_ROLES]],
      );

      expect(result.rows).toHaveLength(SERVING_ROLES.length);
      for (const row of result.rows) {
        expect(row.rolsuper, `${row.rolname} is a superuser`).toBe(false);
        expect(row.rolbypassrls, `${row.rolname} bypasses RLS`).toBe(false);
      }
    },
    TIMEOUT,
  );

  it(
    'the data tables are ENABLEd and FORCEd, and a superuser still reads every row',
    async () => {
      // Both halves, deliberately. The first is the posture the migration
      // asserts. The second is the reason the posture is not sufficient on its
      // own, and it is the finding that makes the attribute test above
      // load-bearing rather than ceremonial.
      const posture = await client.query<{ relname: string; enabled: boolean; forced: boolean }>(
        `SELECT c.relname,
                c.relrowsecurity AS enabled,
                c.relforcerowsecurity AS forced
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname IN ('customers', 'projects')
          ORDER BY c.relname`,
      );

      expect(posture.rows).toHaveLength(2);
      for (const row of posture.rows) {
        expect(row.enabled, `${row.relname} has RLS disabled`).toBe(true);
        expect(row.forced, `${row.relname} does not FORCE RLS, so its owner bypasses it`).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    'the owner is refused DML under FORCE, and DDL is unaffected',
    async () => {
      // What FORCE costs, stated as a fact rather than a caveat. The owner is
      // subject to its own policy, so a seeding INSERT with no claims is
      // rejected. The documented workaround — disabling row_security to seed —
      // would reopen the owner bypass, so it is not used anywhere in this suite.
      await expect(
        client.query(`INSERT INTO projects (site_id, name) VALUES ($1, 'owner-insert')`, [sites.root]),
      ).rejects.toThrow(/row-level security/i);

      // DDL is not subject to RLS, which is what makes FORCE usable at all.
      await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS ddl_probe integer');
      await client.query('ALTER TABLE projects DROP COLUMN ddl_probe');
    },
    TIMEOUT,
  );

  it(
    'seeding succeeds by assuming a role the policy admits, not by disabling row_security',
    async () => {
      // The sanctioned route, proven rather than asserted in a comment. The owner
      // is rejected above; assuming app_admin through the escalation boundary is
      // accepted. `SET row_security = off` would also make the insert succeed and
      // is never used, because it reopens the owner bypass for every later session
      // in the same backend.
      const seeder = authenticatorClient();
      await seeder.connect();
      try {
        await seeder.query('BEGIN');
        await seeder.query('SET LOCAL ROLE app_admin');
        const inserted = await seeder.query<{ id: string }>(
          'INSERT INTO projects (site_id, name) VALUES ($1, $2) RETURNING id',
          [sites.root, 'seeded-as-admin'],
        );
        await seeder.query('COMMIT');

        expect(inserted.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
      } finally {
        await seeder.end();
      }
    },
    TIMEOUT,
  );
});

describe('W07 · function privileges: EXECUTE is granted to PUBLIC by default', () => {
  it(
    'no function in the schema is executable by PUBLIC',
    async () => {
      // Postgres grants EXECUTE on a new function to PUBLIC by default. 7 of 9
      // functions in the earlier spike had a NULL proacl, so any helper was
      // anonymously reachable — and a SECURITY DEFINER helper is then an
      // anonymous privilege escalation, not just an information leak.
      const result = await client.query<{ proname: string; public_may_execute: boolean }>(
        `SELECT p.proname,
                has_function_privilege('public', p.oid, 'EXECUTE') AS public_may_execute
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
          ORDER BY p.proname`,
      );

      expect(result.rows.length).toBeGreaterThan(0);
      for (const row of result.rows) {
        expect(row.public_may_execute, `${row.proname} is executable by PUBLIC`).toBe(false);
      }
    },
    TIMEOUT,
  );

  it(
    'the policy helpers are executable by every role whose requests evaluate the policy',
    async () => {
      // The revoke alone was worse than useless. An earlier version revoked
      // EXECUTE from PUBLIC and granted it to nobody, so every scoped request
      // died with `permission denied for function request_claims` and row
      // scoping was 100% non-functional. Both halves are required.
      //
      // app_anon is included deliberately. A policy expression is evaluated for
      // every role that reaches the table, so omitting the anonymous role makes
      // unauthenticated reads fail with 42501 instead of returning zero rows.
      const result = await client.query<{ proname: string; anon_ok: boolean; member_ok: boolean; admin_ok: boolean }>(
        `SELECT p.proname,
                has_function_privilege('app_anon', p.oid, 'EXECUTE')   AS anon_ok,
                has_function_privilege('app_member', p.oid, 'EXECUTE') AS member_ok,
                has_function_privilege('app_admin', p.oid, 'EXECUTE')  AS admin_ok
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname IN ('request_claims', 'claim_site_id', 'site_tree_ids')
          ORDER BY p.proname`,
      );

      expect(result.rows).toHaveLength(3);
      for (const row of result.rows) {
        expect(row.anon_ok, `app_anon cannot execute ${row.proname}`).toBe(true);
        expect(row.member_ok, `app_member cannot execute ${row.proname}`).toBe(true);
        expect(row.admin_ok, `app_admin cannot execute ${row.proname}`).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    'the hierarchy function is SECURITY DEFINER, and that is load-bearing rather than incidental',
    async () => {
      // The tree walk reads `sites`, whose policy calls the tree walk. With
      // SECURITY INVOKER that is unbounded recursion, and every request as a
      // non-superuser role aborts with `stack depth limit exceeded`. The fix is
      // SECURITY DEFINER plus leaving `sites` un-FORCEd, so the owner is exempt
      // from `sites` RLS inside the function and the walk terminates.
      const definer = await client.query<{ prosecdef: boolean; proretset: boolean }>(
        `SELECT prosecdef, proretset FROM pg_proc WHERE proname = 'site_tree_ids'`,
      );
      expect(definer.rows[0]?.prosecdef).toBe(true);

      // A scalar array, not SETOF. Postgres rejects set-returning functions in a
      // policy expression outright, which is why the original never compiled.
      expect(definer.rows[0]?.proretset).toBe(false);

      // And `sites` must NOT be forced, or the recursion returns.
      const sitesForced = await client.query<{ forced: boolean }>(
        `SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname = 'sites'`,
      );
      expect(sitesForced.rows[0]?.forced).toBe(false);
    },
    TIMEOUT,
  );
});

describe('W07 · grant order: revoking a column under a table-level grant silently does nothing', () => {
  it(
    'internal_notes IS readable when a column revoke is issued while table-level SELECT exists',
    async () => {
      // This test asserts the FAIL-OPEN behaviour, on purpose, in a transaction
      // that is always rolled back. It is the regression guard for the comment
      // above the grants in the migration: a column grant can only narrow a
      // table grant that has already been taken away. It cannot subtract from
      // one. A migration that reorders those two statements loses the column
      // silently — no error, no warning, HTTP 200 with the value intact.
      await client.query('BEGIN');
      try {
        // The wrong order, exactly as an earlier draft had it.
        await client.query('REVOKE ALL ON customers FROM app_member');
        await client.query('GRANT SELECT, INSERT ON customers TO app_member');
        await client.query('GRANT SELECT (id, site_id, name, created_at) ON customers TO app_member');
        await client.query('REVOKE SELECT (internal_notes) ON customers FROM app_member');

        const readable = await client.query<{ readable: boolean }>(
          `SELECT has_column_privilege('app_member', 'customers', 'internal_notes', 'SELECT') AS readable`,
        );

        // Fully readable. The revoke was accepted and did nothing.
        expect(readable.rows[0]?.readable).toBe(true);
      } finally {
        await client.query('ROLLBACK');
      }
    },
    TIMEOUT,
  );

  it(
    'revoking table-level SELECT first is what actually hides the column',
    async () => {
      // The order the migration uses, asserted so the two tests above and this one
      // cannot both be "right" by accident.
      await client.query('BEGIN');
      try {
        await client.query('REVOKE ALL ON customers FROM app_member');
        await client.query('GRANT SELECT, INSERT ON customers TO app_member');
        await client.query('REVOKE SELECT ON customers FROM app_member');
        await client.query('GRANT SELECT (id, site_id, name, created_at) ON customers TO app_member');

        const readable = await client.query<{ readable: boolean }>(
          `SELECT has_column_privilege('app_member', 'customers', 'internal_notes', 'SELECT') AS readable`,
        );

        expect(readable.rows[0]?.readable).toBe(false);
      } finally {
        await client.query('ROLLBACK');
      }
    },
    TIMEOUT,
  );

  it(
    'the migration applies twice in a row without changing any grant',
    async () => {
      // Idempotency is a separate claim from "applies cleanly", and a grant that
      // only survives the first application is a grant that will be lost on the
      // next deploy. The fixture already applied the migration twice; this
      // asserts the resulting privileges rather than the exit code.
      const before = await snapshotPrivileges();
      applyMigrationAsOwner();
      const after = await snapshotPrivileges();

      expect(after).toEqual(before);
    },
    TIMEOUT,
  );
});

/** Removes a row the suite created, through the boundary rather than around it. */
async function removeSeededRow(name: string): Promise<void> {
  const seeder = authenticatorClient();
  await seeder.connect();
  try {
    await seeder.query('BEGIN');
    await seeder.query('SET LOCAL ROLE app_admin');
    await seeder.query('DELETE FROM customers WHERE name = $1', [name]);
    await seeder.query('COMMIT');
  } finally {
    await seeder.end();
  }
}

function readRowAsOwner(siteId: string): Record<string, unknown> {
  // Unfiltered, for the same reason trueCustomerCount is: a filtered read cannot
  // prove a row is unchanged.
  const rows = queryAsSuperuser<Record<string, unknown>>(
    `SELECT id, site_id, name, internal_notes FROM customers WHERE site_id = '${siteId}' ORDER BY id LIMIT 1`,
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`no customer row for site ${siteId}`);
  }
  return row;
}

/**
 * Reads customer names as `role`, with `request.jwt.claims` set to `claims`.
 *
 * `undefined` means the setting is never touched, which is itself one of the
 * shapes under test: the case where a policy used to raise instead of denying.
 *
 * A single `psql -c` invocation rather than two, because `SET LOCAL ROLE` and the
 * read must share one transaction to be scoped correctly.
 */
function visibleCustomerNamesAsRole(role: string, claims: string | undefined): readonly string[] {
  // Fed to psql on stdin rather than via -c, because the script needs `\g
  // /dev/null` to discard the row that `set_config` itself emits. Without it
  // every count below is off by one, which is the kind of error that turns a
  // real leak into a green test.
  //
  // One transaction because `SET LOCAL ROLE` and the read must share one for the
  // SET to be scoped correctly.
  const script = [
    'BEGIN;',
    `SET LOCAL ROLE ${role};`,
    claims === undefined
      ? ''
      : `SELECT set_config('request.jwt.claims', ${quoteSqlLiteral(claims)}, true) \\g /dev/null`,
    'SELECT name FROM customers ORDER BY name;',
    'COMMIT;',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const result = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-d', 'rls_proof'],
    { encoding: 'utf8', input: script },
  );
  if (result.status !== 0) {
    throw new Error(
      `reading customers as ${role} with claims ${claims ?? '(unset)'} failed — the policy raised rather than denying:\n${result.stderr}`,
    );
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Escapes a value for a single-quoted SQL literal. These values are hostile by design. */
function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function snapshotPrivileges(): Promise<string> {
  const result = await client.query<{ grantee: string; table_name: string; privilege_type: string }>(
    `SELECT grantee, table_name, privilege_type
       FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
      ORDER BY grantee, table_name, privilege_type`,
  );
  return JSON.stringify(result.rows);
}
