import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseConfig } from '../support/database.js';
import {
  applyMigrationAsOwner,
  ASSUMABLE_ROLES,
  attemptAsRole,
  attemptAsSuperuser,
  authenticatorClient,
  baseUrl,
  claimsFor,
  explainAsRole,
  GROUP_NAMES,
  GROUPS,
  ownerClient,
  OWNING_ROLE,
  PERMISSIONS,
  projectNamesVisibleTo,
  PROOF_JWT_SECRET,
  queryAsSuperuser,
  rebuildDatabase,
  ROLES,
  seed,
  SERVING_ROLES,
  startPostgrest,
  USERS,
} from './support/fixture.js';
import { mintToken, parseJsonArray, request, sqlStateOf } from './support/jwt.js';

/**
 * W27 — proof that the two-axis authorization model does what ADR-0023 claims:
 * SCOPE in RLS, from membership joined to a precomputed closure, and CAPABILITY in
 * object-level security, resolved from the caller's role rows.
 *
 * Every test names the attack it prevents, because the value of this suite in six
 * months is that a reader can see which claim is load-bearing. "policies work" tells
 * a future maintainer nothing; "a member cannot write their own membership row"
 * tells them what breaks if it fails.
 *
 * Assertions are on bodies and row counts, never on status codes alone. A correct
 * denial, a full `USING (true)` leak and a partial leak were ALL HTTP 200 in the
 * measurement this suite is built on, so a status-only assertion passes on a real
 * leak.
 *
 * If the database or PostgREST is unreachable, `beforeAll` throws and the suite
 * FAILS. There is no skip path: a security suite that passes without exercising its
 * subject is a false green.
 */

const TIMEOUT = 120_000;

let client: Client;
let stopPostgrest: () => void;

/**
 * Row count that sees every row, used to prove nothing was read, written or deleted.
 *
 * Not the owner: under FORCE the owner is bound by its own policy, so a claimless
 * owner read returns 0 rows rather than the true count (verified). A count taken
 * through a filtered path cannot distinguish "nothing was deleted" from "I can see
 * nothing", which would make every denial assertion in this suite vacuous.
 */
function trueProjectCount(): number {
  const rows = queryAsSuperuser<{ count: number }>('SELECT count(*)::int AS count FROM projects');
  const row = rows[0];
  if (row === undefined) {
    throw new Error('counting projects returned no row');
  }
  return row.count;
}

/**
 * Row names a caller can see. A PostgREST error body is a failure of this helper,
 * not an empty result: an error and a denial must never look alike, because "no
 * rows" is the outcome a leak would have to beat.
 */
async function visibleProjectNames(token: string): Promise<readonly string[]> {
  const response = await request(`${baseUrl()}/projects?select=name&order=name`, token);
  return parseJsonArray(response.body).map((row) => String(row['name']));
}

/** Runs a write through the escalation boundary, the only sanctioned writer. */
async function asAdmin<T>(work: (scoped: Client) => Promise<T>): Promise<T> {
  const admin = authenticatorClient();
  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query('SET LOCAL ROLE app_admin');
    try {
      const result = await work(admin);
      await admin.query('COMMIT');
      return result;
    } catch (error) {
      await admin.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    await admin.end();
  }
}

/**
 * Calls the capability resolver over HTTP and returns the answer.
 *
 * PostgREST answers a scalar-returning RPC with the bare value (`true`), not with an
 * object, so this parses the body rather than reaching for a field. Asserting the
 * status here is deliberate: a resolver that errors looks exactly like one that
 * denies unless the two are told apart.
 */
async function rpcHasPermission(token: string, who: string, resource: string, action: string): Promise<boolean> {
  const response = await request(`${baseUrl()}/rpc/has_permission`, token, {
    method: 'POST',
    body: JSON.stringify({ who, resource, action }),
  });
  expect(response.status, `rpc/has_permission returned ${response.status}: ${response.body}`).toBe(200);
  return response.body.trim() === 'true';
}

beforeAll(async () => {
  rebuildDatabase();

  client = new Client({ ...databaseConfig(), database: 'rls_proof' });
  await client.connect();

  await seed();

  const running = await startPostgrest();
  stopPostgrest = running.stop;
}, TIMEOUT);

afterAll(async () => {
  stopPostgrest?.();
  await client?.end();
});

describe('W27 · escalation: the role claim is an attack surface, and the grant is the only boundary', () => {
  it(
    'a validly-signed token naming the table-owning role is refused, and reads nothing',
    async () => {
      // The confirmed live exploit. PostgREST issues SET ROLE for whatever the token
      // names, so an attacker who can get a token minted — or who signs one with a
      // leaked secret — names the role that owns the table and reads every row. The
      // owner is exempt from its own RLS policies, so this is a total bypass, not a
      // widening.
      const escalation = mintToken(PROOF_JWT_SECRET, { role: 'app' });

      const before = trueProjectCount();
      expect(before).toBeGreaterThan(0);

      const read = await request(`${baseUrl()}/projects?select=id,name`, escalation);

      // Asserting the message is what makes this a test of the GRANT rather than of a
      // coincidental 403: any other 403 on this path means a different control fired.
      expect(read.status, `escalation body was: ${read.body}`).toBe(403);
      expect(read.body).toContain('permission denied to set role');
      expect(read.body).not.toContain('project-');
    },
    TIMEOUT,
  );

  it(
    'a validly-signed token naming the table-owning role cannot delete, and the row survives',
    async () => {
      // The other half of the confirmed exploit: the escalation token's DELETE
      // returned 204 and removed the row. Asserting the count is the only way to
      // prove that; a 403 alone would not survive a regression that returned a
      // different error after a successful write.
      const escalation = mintToken(PROOF_JWT_SECRET, { role: 'app' });
      const before = trueProjectCount();

      const removed = await request(`${baseUrl()}/projects`, escalation, { method: 'DELETE' });

      expect(removed.status).toBe(403);
      expect(trueProjectCount()).toBe(before);
    },
    TIMEOUT,
  );

  it(
    'every role other than the three granted ones is refused, including the owner',
    async () => {
      // A denylist would pass the single escalation case above and fail here. The
      // control is an allowlist, so the assertion is over the whole cluster: any role
      // not named in the GRANT must be unreachable from a token.
      const candidates = await client.query<{ rolname: string }>(
        `SELECT rolname FROM pg_roles
          WHERE rolcanlogin OR rolname LIKE 'app\\_%'
          ORDER BY rolname`,
      );

      const granted = new Set<string>(ASSUMABLE_ROLES);
      const refused = candidates.rows.map((row) => row.rolname).filter((name) => !granted.has(name));
      expect(refused.length).toBeGreaterThan(0);

      for (const role of refused) {
        const response = await request(`${baseUrl()}/projects?select=id`, mintToken(PROOF_JWT_SECRET, { role }));
        expect(response.status, `role ${role} was not refused`).toBe(403);
      }
    },
    TIMEOUT,
  );

  it(
    'a member token that forges the admin role claim still sees only its own subtree',
    async () => {
      // The scope policy's admin branch discriminates on `current_user`, which
      // Postgres sets from the SET ROLE the boundary already constrained — not on the
      // token. If the admin tier were read from the claim, a member could promote
      // themselves by editing one JSON field of a validly-signed token.
      const forged = mintToken(PROOF_JWT_SECRET, {
        role: 'app_member',
        sub: USERS.euMember,
        // A group field the design promises to ignore: scope comes from membership,
        // never from the token. Present, well-formed, and inert.
        group_id: GROUPS.hq,
      });
      const genuineAdmin = mintToken(PROOF_JWT_SECRET, { role: 'app_admin', sub: USERS.administrator });

      expect(await visibleProjectNames(forged)).toEqual(['project-EU', 'project-FR', 'project-UK']);
      expect(await visibleProjectNames(genuineAdmin)).toHaveLength(GROUP_NAMES.length);
    },
    TIMEOUT,
  );

  it(
    'an anonymous request is refused at the grant layer, never at the policy layer',
    async () => {
      // A denial must arrive as a denial. An earlier revision granted EXECUTE on the
      // policy helpers to app_member and app_admin but not app_anon, so this exact
      // request failed INSIDE the policy rather than at the grant layer. A policy that
      // errors is a denial-of-service surface and it tells an anonymous caller that a
      // policy exists and which function to look for.
      const anonymous = await request(`${baseUrl()}/projects?select=id`);

      expect(anonymous.status).toBe(401);
      expect(anonymous.body).toContain('permission denied for table');
      // The oracle: this string would mean the policy could not be evaluated at all.
      expect(anonymous.body).not.toContain('permission denied for function');
      expect(anonymous.body).not.toContain('project-');
    },
    TIMEOUT,
  );
});

describe('W27 · scope: membership joined to the closure, not a token claim', () => {
  it(
    'a member of EU sees EU, UK and FR, and does not see HQ or US',
    async () => {
      // The canonical case, and the one a per-row walk keyed on a claim could not
      // produce: scope is a SUBTREE, resolved from a membership row.
      const names = await visibleProjectNames(mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.euMember }));

      expect(names).toEqual(['project-EU', 'project-FR', 'project-UK']);
      expect(names).not.toContain('project-HQ');
      expect(names).not.toContain('project-US');
    },
    TIMEOUT,
  );

  it(
    'a member of HQ sees everything beneath HQ',
    async () => {
      const names = await visibleProjectNames(mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.hqMember }));

      expect(names).toEqual(['project-APAC', 'project-EU', 'project-FR', 'project-HQ', 'project-UK']);
    },
    TIMEOUT,
  );

  it(
    'a member of two disjoint groups sees the union, never the intersection',
    async () => {
      // The case an `AND` would get wrong. Membership in EU and in US must yield
      // EU+UK+FR+US. An intersection would yield nothing, and a policy that returned
      // everything would also "pass" a count-only assertion, so the names are checked.
      const names = await visibleProjectNames(
        mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.disjointMember }),
      );

      expect(names).toEqual(['project-EU', 'project-FR', 'project-UK', 'project-US']);
      expect(names).not.toContain('project-HQ');
      expect(names).not.toContain('project-APAC');
    },
    TIMEOUT,
  );

  it(
    'a member with no membership rows sees zero rows and no error',
    async () => {
      // The scope-side cross test. Both withdrawn policy shapes pass every per-half
      // test and fail here.
      const names = await visibleProjectNames(
        mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.noMembership }),
      );

      expect(names).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'an admin sees every row, and scope narrows again the moment the role does',
    async () => {
      const admin = await visibleProjectNames(
        mintToken(PROOF_JWT_SECRET, { role: 'app_admin', sub: USERS.administrator }),
      );
      const member = await visibleProjectNames(
        mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.hqMember }),
      );

      expect(admin).toHaveLength(GROUP_NAMES.length);
      expect(member).toHaveLength(GROUP_NAMES.length - 1);
    },
    TIMEOUT,
  );

  it(
    'a membership revoked since the token was minted changes scope on the next request, same token',
    async () => {
      // The operational payoff of reading membership from a table: revocation does not
      // wait for token expiry. The token is minted ONCE and used for both reads, so a
      // policy that cached scope in the token — or in a GUC the caller can set — fails
      // this while passing every static test above.
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.euMember });
      expect(await visibleProjectNames(token)).toHaveLength(3);

      const owner = ownerClient();
      await owner.connect();
      try {
        await owner.query('DELETE FROM user_groups WHERE user_id = $1 AND group_id = $2', [
          USERS.euMember,
          GROUPS.eu,
        ]);
        expect(await visibleProjectNames(token)).toEqual([]);

        await owner.query('INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)', [USERS.euMember, GROUPS.eu]);
        expect(await visibleProjectNames(token)).toHaveLength(3);
      } finally {
        await owner.end();
      }
    },
    TIMEOUT,
  );

  it(
    'the scoping subquery is evaluated once per statement, not once per row',
    async () => {
      // The whole performance argument, and it is assertable: `hashed SubPlan` with
      // loops = 1 at more than three thousand candidate rows. Assert on `loops`, not
      // on the SQL's apparent shape — an EXISTS-shaped variant is simplified back
      // into a hashed SubPlan by the planner, so reading the policy text proves
      // nothing. A correlated or per-row variant gives loops = N and this fails.
      await asAdmin(async (admin) => {
        await admin.query(
          `INSERT INTO projects (group_id, name)
             SELECT $1, 'bulk-' || g FROM generate_series(1, 3300) g`,
          [GROUPS.eu],
        );
      });

      try {
        const explain = explainAsRole(
          'app_member',
          claimsFor(USERS.euMember, 'app_member'),
          'SELECT count(*) FROM projects',
        );

        expect(explain).toMatch(/hashed SubPlan/);
        const loops = [...explain.matchAll(/SubPlan \d+[\s\S]*?loops=(\d+)/g)].map((match) => match[1]);
        expect(loops.length).toBeGreaterThan(0);
        for (const loop of loops) {
          expect(Number(loop), `policy subplan ran ${loop} times, not once`).toBe(1);
        }
      } finally {
        await asAdmin(async (admin) => {
          await admin.query(`DELETE FROM projects WHERE name LIKE 'bulk-%'`);
        });
      }
    },
    TIMEOUT,
  );
});

describe('W27 · scope: one expression governs visibility and insertability', () => {
  it(
    'a member cannot insert a row into a group outside its closure, and the row is absent',
    async () => {
      // WITH CHECK is deliberately omitted from the policy, because Postgres reuses
      // USING for inserts. A catalog entry is evidence that something was set; a
      // refused insert is evidence that something was ENFORCED.
      const before = trueProjectCount();
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.ukMember });

      const inserted = await request(`${baseUrl()}/projects`, token, {
        method: 'POST',
        body: JSON.stringify({ group_id: GROUPS.us, name: 'out-of-scope' }),
      });

      expect(inserted.status).toBe(403);
      expect(inserted.body).toContain('row-level security');
      expect(trueProjectCount()).toBe(before);
    },
    TIMEOUT,
  );

  it(
    'a member CAN insert into its own group, so the refusal above is a policy and not a lockout',
    async () => {
      // A test that only proves denial passes just as well against a table nobody can
      // write. This is the permitted case for the same grant and the same policy.
      const before = trueProjectCount();
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.ukMember });

      const inserted = await request(`${baseUrl()}/projects`, token, {
        method: 'POST',
        body: JSON.stringify({ group_id: GROUPS.uk, name: 'in-scope' }),
      });

      expect(inserted.status).toBe(201);
      expect(trueProjectCount()).toBe(before + 1);

      // Removed through the boundary, because the exact-count assertions later in the
      // suite must not depend on execution order. A test that leaves state behind is
      // how a suite starts passing for the wrong reason.
      await asAdmin(async (admin) => {
        await admin.query(`DELETE FROM projects WHERE name = 'in-scope'`);
      });
    },
    TIMEOUT,
  );

  it(
    'a member cannot UPDATE a visible row to move it out of its closure',
    async () => {
      // USING is re-checked against the NEW row, so this is the write-side half of
      // "one expression governs both". A policy that filtered only on the old row
      // would let a member plant a row in a group they cannot read.
      const before = await client.query<{ group_id: string }>(
        'SELECT group_id FROM projects WHERE group_id = $1 ORDER BY id LIMIT 1',
        [GROUPS.uk],
      );
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.ukMember });

      const moved = await request(`${baseUrl()}/projects`, token, {
        method: 'PATCH',
        body: JSON.stringify({ group_id: GROUPS.us }),
      });

      // Either the verb grant or the policy can refuse this; both are refusals, and
      // the assertion that matters is that the row did not move.
      expect([403, 405]).toContain(moved.status);
      const after = await client.query<{ group_id: string }>(
        'SELECT group_id FROM projects WHERE group_id = $1 ORDER BY id LIMIT 1',
        [GROUPS.uk],
      );
      expect(after.rows[0]?.group_id).toBe(before.rows[0]?.group_id);
    },
    TIMEOUT,
  );
});

describe('W27 · capability: resolved from the caller role rows, inheriting UP the role tree', () => {
  it(
    'has_permission returns TRUE for an actor who HOLDS the permission through a parent role',
    async () => {
      // The positive case, and the one every denial-only test is blind to. The
      // withdrawn resolver read `current_user` inside a SECURITY DEFINER function,
      // which rebinds to the function OWNER, so it answered identically for everyone:
      // an unconditional false, indistinguishable from a working check. Measured on
      // that resolver: false for the administrator WHILE HOLDING the row.
      // contributor's parent is viewer, and viewer holds project/read. Two levels of
      // inheritance, neither of which is a row on the contributor itself.
      expect(
        await rpcHasPermission(
          mintToken(PROOF_JWT_SECRET, { role: 'app_member' }),
          USERS.euMember,
          'project',
          'read',
        ),
      ).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'has_permission inherits two levels up, and returns false for a permission held only by a sibling role',
    async () => {
      // One test, two halves, because a resolver that ignores the role hierarchy
      // passes the second half and a resolver that grants everything passes the first.
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member' });

      // manager -> contributor -> viewer. viewer holds project/read.
      expect(await rpcHasPermission(token, USERS.administrator, 'project', 'read')).toBe(true);
      expect(await rpcHasPermission(token, USERS.ukMember, 'project', 'create')).toBe(false);
      expect(await rpcHasPermission(token, USERS.ukMember, 'page', 'update')).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'the resource and the action are separate columns, so a permission in one resource does not satisfy another',
    async () => {
      // The defect this guards is silent: in a SQL function an unqualified name that
      // also names a column resolves to the COLUMN, so `p.resource = resource` parses
      // as `p.resource = p.resource` and the resource filter becomes vacuous.
      // Measured on the unfixed body: project/read answered true on the strength of a
      // customer/read row.
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member' });
      expect(await rpcHasPermission(token, USERS.euMember, 'project', 'read')).toBe(true);

      // The same actor holds customer/read directly, and project/read only by
      // inheritance. A resolver that ignored `resource` or `action` would answer true
      // for the pairs below as well.
      expect(await rpcHasPermission(token, USERS.euMember, 'widget', 'read')).toBe(false);
      expect(await rpcHasPermission(token, USERS.euMember, 'project', 'publish')).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'has_permission returns false for an actor with no role rows',
    async () => {
      expect(await rpcHasPermission(mintToken(PROOF_JWT_SECRET, { role: 'app_member' }), USERS.noRole, 'project', 'read')).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'app_admin holds EVERY capability that exists, so the resolver is a superset and not a bypass',
    async () => {
      // The "all pages" mechanism of the four-surface superset. Read from the live
      // tables rather than from a list in this file, so a new permission row cannot be
      // added without this becoming false.
      const permissionCount = queryAsSuperuser<{ count: number }>('SELECT count(*)::int AS count FROM permissions')[0];
      const heldCount = queryAsSuperuser<{ count: number }>(
        `SELECT count(*)::int AS count FROM role_permissions WHERE role_id = '${ROLES.administrator}'`,
      )[0];

      expect(permissionCount?.count).toBeGreaterThan(0);
      expect(heldCount?.count).toBe(permissionCount?.count);

      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member' });
      for (const permission of PERMISSIONS) {
        const [resource = '', action = ''] = permission.split('.');
        expect(await rpcHasPermission(token, USERS.administrator, resource, action)).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    'has_permission is SECURITY DEFINER, so no serving role needs to read the permission matrix',
    async () => {
      // Two reasons it must stay DEFINER, asserted as one fact plus one consequence:
      // (1) recursion — reading roles from inside a policy on roles is the documented
      // policy-recursion trap, and INVOKER would be subject to that policy;
      // (2) publication — INVOKER would need SELECT on role_permissions and
      // permissions for every serving role, which publishes the whole matrix.
      const resolver = await client.query<{ prosecdef: boolean; provolatile: string }>(
        `SELECT prosecdef, provolatile FROM pg_proc WHERE proname = 'has_permission'`,
      );
      expect(resolver.rows[0]?.prosecdef).toBe(true);
      expect(resolver.rows[0]?.provolatile).toBe('s');

      const readable = await client.query<{ readable: boolean }>(
        `SELECT has_table_privilege('app_member', 'role_permissions', 'SELECT') AS readable`,
      );
      expect(readable.rows[0]?.readable, 'a member can read the permission matrix').toBe(false);
    },
    TIMEOUT,
  );

  it(
    'role_permissions.role_id is a real foreign key to roles.id, so "what can this role do" is answerable',
    async () => {
      // The withdrawn capability table was keyed on a PostgreSQL ROLE NAME, which left
      // the roles table referenced by nothing: no query, no constraint and no migration
      // could answer what a role could do.
      const foreignKey = await client.query<{ conname: string }>(
        `SELECT conname
           FROM pg_constraint
          WHERE conrelid = 'role_permissions'::regclass
            AND contype = 'f'
            AND confrelid = 'roles'::regclass`,
      );
      expect(foreignKey.rows).toHaveLength(1);

      const answerable = queryAsSuperuser<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM roles r
           JOIN role_permissions rp ON rp.role_id = r.id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name = 'viewer'`,
      )[0];
      expect(answerable?.count).toBe(2);
    },
    TIMEOUT,
  );

  it(
    'no per-user grant, deny or combiner table exists',
    async () => {
      // `user_permissions`, `is_granted` and `permission_rules` are withdrawn designs.
      // A regression here would put both axes on one row, which is the arrangement
      // that produced the recorded escalation.
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema IN ('public', 'authz')
            AND table_name = ANY($1)`,
        [['user_permissions', 'permission_rules', 'rls_rules', 'rls_join_paths', 'cache_permission_maps', 'api_endpoints']],
      );
      expect(tables.rows).toEqual([]);

      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema IN ('public', 'authz') AND column_name = 'is_granted'`,
      );
      expect(columns.rows).toEqual([]);

      // And no raw-SQL column: the policy IS the SQL, so a table that stores SQL for
      // the policy to run is a second source of truth for the one thing that must not
      // have one.
      const rawSql = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema IN ('public', 'authz')
            AND column_name = ANY($1)`,
        [['sql', 'scope_sql', 'parameters']],
      );
      expect(rawSql.rows).toEqual([]);
    },
    TIMEOUT,
  );
});

describe('W27 · operation: verbs are withheld by grants, and capability does not widen scope', () => {
  it(
    'app_member may SELECT and INSERT but not UPDATE, DELETE or PUT, and the rows are unchanged',
    async () => {
      // The point of a grant is that it holds with no application code in the path.
      // These verbs are refused by Postgres, and the rows are re-read to prove the
      // refusal was a refusal and not a silent no-op.
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.euMember });
      const before = await client.query('SELECT id, group_id, name FROM projects ORDER BY id');

      for (const method of ['PATCH', 'PUT', 'DELETE']) {
        const response = await request(`${baseUrl()}/projects`, token, {
          method,
          body: method === 'DELETE' ? undefined : JSON.stringify({ group_id: GROUPS.eu, name: 'renamed' }),
        });
        expect([403, 405], `${method} returned ${response.status}: ${response.body}`).toContain(response.status);
      }

      const after = await client.query('SELECT id, group_id, name FROM projects ORDER BY id');
      expect(after.rows).toEqual(before.rows);
    },
    TIMEOUT,
  );

  it(
    'app_admin holds the verbs app_member does not',
    async () => {
      // The other side of the same grant, so a migration that granted everything to
      // everyone would fail here rather than passing on denials alone.
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_admin', sub: USERS.administrator });
      const inserted = await request(`${baseUrl()}/projects`, token, {
        method: 'POST',
        body: JSON.stringify({ group_id: GROUPS.us, name: 'written-by-admin' }),
      });
      expect(inserted.status).toBe(201);

      const updated = await request(`${baseUrl()}/projects?name=eq.written-by-admin`, token, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'renamed-by-admin' }),
      });
      expect(updated.status).toBe(204);

      const removed = await request(`${baseUrl()}/projects?name=eq.renamed-by-admin`, token, { method: 'DELETE' });
      expect([204, 200]).toContain(removed.status);
    },
    TIMEOUT,
  );

  it(
    'internal_notes cannot be selected by app_member, and the secret is absent from the body',
    async () => {
      // Asserted on the body, never the status. With a table-level SELECT grant in
      // place the column comes back at HTTP 200 with its value intact, and only the
      // body shows it.
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.euMember });

      const explicit = await request(`${baseUrl()}/customers?select=internal_notes`, token);
      expect(explicit.status).toBe(403);
      expect(explicit.body).not.toContain('SECRET-');

      // select=* is also refused for a column-restricted role, so the wildcard cannot
      // smuggle the column out.
      const wildcard = await request(`${baseUrl()}/customers?select=*`, token);
      expect(wildcard.status).toBe(403);
      expect(wildcard.body).not.toContain('SECRET-');
    },
    TIMEOUT,
  );

  it(
    'the readable columns still work, so the restriction is a restriction and not a lockout',
    async () => {
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.euMember });
      const allowed = await request(`${baseUrl()}/customers?select=group_id,name&order=name`, token);

      expect(allowed.status).toBe(200);
      expect(parseJsonArray(allowed.body)).toHaveLength(3);
    },
    TIMEOUT,
  );

  it(
    'projects.internal_notes cannot be selected by app_member either, and the value is absent',
    async () => {
      // The column existed only so a column-grant test would have something to hide,
      // and every column-hiding test in this suite used `customers`. So the grant on
      // the second scoped table was correct and completely unasserted: widening
      // `GRANT SELECT (group_id, id, name, budget_cents, created_at)` to include
      // internal_notes would have turned every test in this file green.
      //
      // Two tables means two grants with two column lists, and a copy-paste edit that
      // fixed one list and not the other is the realistic regression.
      const seeded = await asAdmin(async (admin) =>
        admin.query<{ internal_notes: string }>(
          `UPDATE projects SET internal_notes = 'SECRET-PROJECT' WHERE group_id = $1 RETURNING internal_notes`,
          [GROUPS.eu],
        ),
      );
      expect(seeded.rows[0]?.internal_notes).toBe('SECRET-PROJECT');

      try {
        const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.euMember });

        const explicit = await request(`${baseUrl()}/projects?select=internal_notes`, token);
        expect(explicit.status).toBe(403);
        expect(explicit.body).not.toContain('SECRET-PROJECT');

        // `select=*` cannot smuggle it out either, for the same reason as customers.
        const wildcard = await request(`${baseUrl()}/projects?select=*`, token);
        expect(wildcard.status).toBe(403);
        expect(wildcard.body).not.toContain('SECRET-PROJECT');

        // The catalog, which is the control rather than one consequence of it, and the
        // permitted case so the grant is a narrowing rather than a lockout.
        for (const role of ['app_anon', 'app_member', 'pgrst_authenticator']) {
          const readable = await client.query<{ readable: boolean }>(
            `SELECT has_column_privilege($1, 'projects', 'internal_notes', 'SELECT') AS readable`,
            [role],
          );
          expect(readable.rows[0]?.readable, `${role} can read projects.internal_notes`).toBe(false);
        }

        const adminReadable = await client.query<{ readable: boolean }>(
          `SELECT has_column_privilege('app_admin', 'projects', 'internal_notes', 'SELECT') AS readable`,
        );
        expect(adminReadable.rows[0]?.readable, 'the admin cannot read projects.internal_notes').toBe(true);

        const permitted = await request(`${baseUrl()}/projects?select=name,budget_cents&order=name`, token);
        expect(permitted.status).toBe(200);
        expect(parseJsonArray(permitted.body).length).toBeGreaterThan(0);
      } finally {
        await asAdmin(async (admin) => {
          await admin.query(`UPDATE projects SET internal_notes = NULL WHERE group_id = $1`, [GROUPS.eu]);
        });
      }
    },
    TIMEOUT,
  );

  it(
    'internal_notes is unreadable by every column-restricted role, and the admin still reads it',
    async () => {
      // Ground truth for the comparison: the data is really there, so the denials
      // above are denials and not an empty table.
      const asOwner = queryAsSuperuser<{ notes: string | null }>(
        'SELECT internal_notes AS notes FROM customers LIMIT 1',
      );
      expect(asOwner[0]?.notes).toMatch(/^SECRET-/);

      // app_admin is excluded from the loop and asserted separately below: it holds
      // table-level SELECT, which is the point of a superset rather than a bypass —
      // the admin is wider everywhere, not narrower somewhere by accident.
      for (const role of ['app_anon', 'app_member', 'pgrst_authenticator']) {
        const readable = await client.query<{ readable: boolean }>(
          `SELECT has_column_privilege($1, 'customers', 'internal_notes', 'SELECT') AS readable`,
          [role],
        );
        expect(readable.rows[0]?.readable, `${role} can read internal_notes`).toBe(false);
      }

      const adminReadable = await client.query<{ readable: boolean }>(
        `SELECT has_column_privilege('app_admin', 'customers', 'internal_notes', 'SELECT') AS readable`,
      );
      expect(adminReadable.rows[0]?.readable, 'the admin cannot read internal_notes').toBe(true);
    },
    TIMEOUT,
  );

  it(
    'app_admin holds every verb on every table except membership, asserted against pg_tables',
    async () => {
      // "All tables" is the second of the four superset surfaces, and a hand-written
      // list is how a new table ends up silently uncovered: it would simply be missing
      // from the list. `pg_tables` cannot be out of date.
      //
      // The one exception is membership, and it is not an oversight: user_groups is
      // writable by NO serving role, including this one, because a member who can
      // write their own membership row widens their own scope in one statement. The
      // admin reaches it with SELECT only. Named here and asserted below rather than
      // buried, so adding a second exception means editing this test.
      const tables = await client.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
      expect(tables.rows.length).toBeGreaterThan(0);

      const uncovered: string[] = [];
      for (const row of tables.rows) {
        const writable = row.tablename === 'user_groups' ? ['SELECT'] : ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
        for (const privilege of writable) {
          const granted = await client.query<{ holds: boolean }>(
            `SELECT has_table_privilege('app_admin', $1, $2) AS holds`,
            [row.tablename, privilege],
          );
          if (granted.rows[0]?.holds !== true) {
            uncovered.push(`${row.tablename}:${privilege}`);
          }
        }
      }
      expect(uncovered).toEqual([]);

      const membershipWrite = await client.query<{ insert: boolean }>(
        `SELECT has_table_privilege('app_admin', 'user_groups', 'INSERT') AS insert`,
      );
      expect(membershipWrite.rows[0]?.insert, 'app_admin can write membership').toBe(false);
    },
    TIMEOUT,
  );

  it(
    'user_groups is not writable by ANY serving role, and a member reads only their own membership',
    async () => {
      // The grant that fails OPEN if forgotten: a member who can write their own
      // membership row widens their own scope in one statement, and the scope policy
      // honours it, because the policy reads the table the caller just wrote. Refused
      // for app_admin as well, because the admin is a serving role like any other.
      for (const role of ASSUMABLE_ROLES) {
        const holds = await client.query<{ insert: boolean; update: boolean; delete: boolean }>(
          `SELECT has_table_privilege($1, 'user_groups', 'INSERT')  AS insert,
                  has_table_privilege($1, 'user_groups', 'UPDATE')  AS update,
                  has_table_privilege($1, 'user_groups', 'DELETE')  AS delete`,
          [role],
        );
        expect(holds.rows[0]?.insert, `${role} can insert membership`).toBe(false);
        expect(holds.rows[0]?.update, `${role} can update membership`).toBe(false);
        expect(holds.rows[0]?.delete, `${role} can delete membership`).toBe(false);
      }

      // The scope policy reads this table with the QUERYING role's privileges, so a
      // grant is required — and the grant is safe because membership carries its own
      // policy: a member reads their rows and nobody else's.
      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.euMember });
      const mine = await request(`${baseUrl()}/user_groups?select=group_id`, token);
      expect(mine.status).toBe(200);
      expect(parseJsonArray(mine.body).map((row) => row['group_id'])).toEqual([GROUPS.eu]);

      const someoneElses = await request(`${baseUrl()}/user_groups?group_id=eq.${GROUPS.hq}`, token);
      expect(parseJsonArray(someoneElses.body)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'app_admin sees every membership row, and the admin branch of the user_groups policy is load-bearing',
    async () => {
      // The `current_user = 'app_admin' OR` clause on the user_groups policy had no
      // test. Delete it and this entire suite stays green — the policy degrades to
      // "a caller sees their own membership rows", which every other membership
      // assertion still satisfies, because every other membership assertion is made BY
      // A MEMBER.
      //
      // A self-only membership read is not merely inconvenient: the scope policy
      // resolves through this table, so an operator who cannot see who belongs to
      // what cannot answer "why does this user see this row", which is the first
      // question asked of any authorization incident.
      const total = queryAsSuperuser<{ count: number }>('SELECT count(*)::int AS count FROM user_groups')[0];
      expect(total?.count).toBeGreaterThan(1);

      const admin = mintToken(PROOF_JWT_SECRET, { role: 'app_admin', sub: USERS.administrator });
      const response = await request(`${baseUrl()}/user_groups?select=user_id,group_id`, admin);

      expect(response.status, `admin membership read returned ${response.status}: ${response.body}`).toBe(200);
      const rows = parseJsonArray(response.body);
      expect(rows).toHaveLength(total?.count);

      // Membership, not just count: a count equal to the total could also be a filter
      // that returned a different set of the same size. The seeded administrator is in
      // exactly one group, and the seeded EU member is in exactly one, so the admin
      // seeing both proves it is reading rows that are not its own.
      const pairs = rows.map((row) => `${String(row['user_id'])}:${String(row['group_id'])}`).sort();
      expect(pairs).toContain(`${USERS.administrator}:${GROUPS.hq}`);
      expect(pairs).toContain(`${USERS.euMember}:${GROUPS.eu}`);
      expect(pairs).toContain(`${USERS.disjointMember}:${GROUPS.us}`);
    },
    TIMEOUT,
  );
});

describe('W27 · cycle safety: the closure query terminates and bad data never arrives', () => {
  it(
    'a two-node group cycle is refused and both rows survive',
    async () => {
      // `parent_id REFERENCES groups(id)` does not enforce acyclicity — a
      // self-referencing FK admits A -> B -> A — so the guard is a trigger, not a
      // constraint. A tolerated cycle is fail-closed on the query and fail-OPEN on the
      // data: each cycle member inherits the whole cycle's scope.
      const before = await client.query('SELECT id, parent_id FROM groups ORDER BY id');

      await expect(
        asAdmin(async (admin) =>
          admin.query(`UPDATE groups SET parent_id = $1 WHERE id = $2`, [GROUPS.uk, GROUPS.hq]),
        ),
      ).rejects.toThrow(/group cycle/i);

      const after = await client.query('SELECT id, parent_id FROM groups ORDER BY id');
      expect(after.rows).toEqual(before.rows);
    },
    TIMEOUT,
  );

  it(
    'a group cannot be re-parented onto its own descendant, and cannot parent itself',
    async () => {
      // Both shapes a closure would otherwise absorb silently: EU under its own child
      // FR, and UK under itself.
      await expect(
        asAdmin(async (admin) => admin.query(`UPDATE groups SET parent_id = $1 WHERE id = $2`, [GROUPS.fr, GROUPS.eu])),
      ).rejects.toThrow(/group cycle/i);

      await expect(
        asAdmin(async (admin) => admin.query('UPDATE groups SET parent_id = id WHERE id = $1', [GROUPS.uk])),
      ).rejects.toThrow(/group cycle/i);
    },
    TIMEOUT,
  );

  it(
    'a two-node role cycle is refused',
    async () => {
      // The capability hierarchy has the same failure mode: a cyclic role graph makes
      // each role in the cycle inherit the entire cycle's permissions.
      await expect(
        asAdmin(async (admin) =>
          admin.query(`UPDATE roles SET parent_id = $1 WHERE id = $2`, [ROLES.manager, ROLES.viewer]),
        ),
      ).rejects.toThrow(/role cycle/i);

      const holder = await client.query<{ parent_id: string | null }>(
        'SELECT parent_id FROM roles WHERE id = $1',
        [ROLES.viewer],
      );
      expect(holder.rows[0]?.parent_id).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'the closure holds exactly the ancestor pairs the tree implies, and never a cycle',
    () => {
      // UNION with no accumulator is what terminates on a cycle; the shape is
      // asserted from the data because on an acyclic tree UNION and UNION ALL are
      // indistinguishable — the property is invisible until it is broken.
      const pairs = queryAsSuperuser<{ ancestor: string; descendant: string }>(
        `SELECT a.name AS ancestor, d.name AS descendant
           FROM authz.org_closure c
           JOIN groups a ON a.id = c.ancestor
           JOIN groups d ON d.id = c.descendant
          ORDER BY 1, 2`,
      ).map((row) => `${row.ancestor}->${row.descendant}`);

      expect(pairs).toEqual([
        'APAC->APAC',
        'EU->EU',
        'EU->FR',
        'EU->UK',
        'FR->FR',
        'HQ->APAC',
        'HQ->EU',
        'HQ->FR',
        'HQ->HQ',
        'HQ->UK',
        'UK->UK',
        'US->US',
      ]);
    },
    TIMEOUT,
  );

  it(
    'the closure is refreshed inside the writing transaction, so a reader never sees a stale one',
    async () => {
      // No staleness window: the refresh runs in the writing transaction, so a reader
      // sees either the pre-write closure or the post-write closure. Adding a group
      // and reading it back immediately is the observable form of that claim.
      const id = await asAdmin(async (admin) => {
        const result = await admin.query<{ id: string }>(
          `INSERT INTO groups (name, parent_id) VALUES ('sub-of-eu', $1) RETURNING id`,
          [GROUPS.eu],
        );
        return result.rows[0]?.id;
      });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      const token = mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.euMember });
      const seeded = await asAdmin(async (admin) => {
        await admin.query('INSERT INTO projects (group_id, name) VALUES ($1, $2)', [id, 'project-sub-of-eu']);
      });
      expect(seeded).toBeUndefined();

      expect(await visibleProjectNames(token)).toContain('project-sub-of-eu');

      await asAdmin(async (admin) => {
        await admin.query('DELETE FROM projects WHERE group_id = $1', [id]);
        await admin.query('DELETE FROM groups WHERE id = $1', [id]);
      });
    },
    TIMEOUT,
  );

  it(
    'a three-node cycle created by ONE multi-row INSERT is refused, and no row of it survives',
    async () => {
      // This passes because of a property of `FOR EACH ROW` nobody planned: Postgres
      // advances the command counter between trigger firings, so a BEFORE ROW
      // trigger's own SELECT sees the rows written earlier in the SAME command.
      //
      // The shape matters and the obvious shape does NOT test it. A backwards chain —
      // (a, no parent), (b, parent a), (c, parent b) — is genuinely acyclic at the
      // moment each row is checked, so the trigger is right to admit it; measured, the
      // insert succeeds and no cycle exists. A FORWARD chain is the cycle: every row's
      // parent is written LATER in the same statement, so the statement as a whole
      // closes a loop that no single row closes on its own. It is the shape a bulk
      // load produces when the source data is a cycle, and the only thing that stops
      // it is the third row's walk seeing the first two.
      //
      // Without the property, a bulk group load becomes a way to install a cyclic
      // closure — which would still answer, still terminate, and be wrong. Nothing else
      // in the schema notices. So this is not a duplicate of the two-node case: it is
      // the only test of intra-command visibility, and it must not be deleted as
      // redundant with the single-row ones.
      const before = await client.query('SELECT id, parent_id FROM groups ORDER BY id');
      const first = '00000000-0000-0000-0000-00000000c001';
      const second = '00000000-0000-0000-0000-00000000c002';
      const third = '00000000-0000-0000-0000-00000000c003';

      // first -> second -> third -> first, every parent written after its child.
      await expect(
        asAdmin(async (admin) =>
          admin.query(
            `INSERT INTO groups (id, name, parent_id) VALUES ($1, 'cycle-a', $2), ($2, 'cycle-b', $3), ($3, 'cycle-c', $1)`,
            [first, second, third],
          ),
        ),
      ).rejects.toThrow(/group cycle/i);

      const after = await client.query('SELECT id, parent_id FROM groups ORDER BY id');
      expect(after.rows).toEqual(before.rows);
    },
    TIMEOUT,
  );

  it(
    'a three-node re-parenting in ONE multi-row UPDATE is refused, and every parent_id survives',
    async () => {
      // The UPDATE half of the same property. A single-statement re-parenting is the
      // shape a hierarchy import or a merge script produces, so it is the realistic
      // bulk case rather than a contrived one.
      //
      // Built as one UPDATE that would close a loop: EU under UK, UK under FR, FR
      // under EU, all in one command. A before-row guard that could not see its own
      // statement's earlier writes would admit all three.
      const before = await client.query('SELECT id, parent_id FROM groups ORDER BY id');

      await expect(
        asAdmin(async (admin) =>
          admin.query(
            `UPDATE groups SET parent_id = CASE id
                WHEN $1 THEN $3
                WHEN $3 THEN $4
                WHEN $4 THEN $1
              END
             WHERE id = ANY($2)`,
            [GROUPS.eu, [GROUPS.eu, GROUPS.uk, GROUPS.fr], GROUPS.uk, GROUPS.fr],
          ),
        ),
      ).rejects.toThrow(/group cycle/i);

      const after = await client.query('SELECT id, parent_id FROM groups ORDER BY id');
      expect(after.rows).toEqual(before.rows);
    },
    TIMEOUT,
  );

  it(
    'a multi-row INSERT of a three-node role cycle is refused too, on the capability hierarchy',
    async () => {
      // The same intra-command property is asserted on the second hierarchy, because
      // the two guards are separate functions and a fix to one is not a fix to the
      // other. A cyclic role graph makes each member inherit the whole cycle's
      // permissions — the identical fail-open, on the axis that decides what a user
      // may do at all.
      await expect(
        asAdmin(async (admin) =>
          admin.query(
            `INSERT INTO roles (id, name, parent_id) VALUES ($1, 'ring-a', $2), ($2, 'ring-b', $3), ($3, 'ring-c', $1)`,
            [
              '00000000-0000-0000-0000-00000000c011',
              '00000000-0000-0000-0000-00000000c012',
              '00000000-0000-0000-0000-00000000c013',
            ],
          ),
        ),
      ).rejects.toThrow(/role cycle/i);

      const survivors = queryAsSuperuser<{ count: number }>(
        `SELECT count(*)::int AS count FROM roles WHERE name LIKE 'ring-%'`,
      )[0];
      expect(survivors?.count).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'the cycle guards are SECURITY INVOKER, and that asymmetry is asserted so it cannot drift',
    async () => {
      // The asymmetry: `refresh_org_closure()` is SECURITY DEFINER because REFRESH
      // requires ownership and because the refresh must see the WHOLE tree. The two
      // guards are the opposite, and the reason is a real limitation rather than a
      // style choice — a SECURITY INVOKER walk reads the tree with the CALLER's
      // privileges, so under a narrowed policy it is RLS-filtered and can
      // UNDER-DETECT a cycle.
      //
      // So `prosecdef = false` is asserted here for a specific reason: if either guard
      // is ever promoted to DEFINER — which is what the migration says to do the day
      // either hierarchy becomes member-writable — this test goes red, and the
      // promotion becomes a deliberate edit with its escalation surface reconsidered
      // instead of an accident. Without this assertion the two guards could be left
      // in different modes with nothing to notice.
      //
      // Asserting the CURRENT value is the point. A test asserting `true` here would
      // enshrine the trap.
      const guards = await client.query<{ proname: string; prosecdef: boolean }>(
        `SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('assert_group_acyclic', 'assert_role_acyclic') ORDER BY proname`,
      );

      expect(guards.rows.map((row) => row.proname)).toEqual(['assert_group_acyclic', 'assert_role_acyclic']);
      for (const row of guards.rows) {
        expect(row.prosecdef, `${row.proname} is SECURITY DEFINER and its walk no longer sees the caller's tree`).toBe(false);
      }

      // The other half of the caveat, asserted together with it: the guard is only
      // sufficient because the GRANT refuses a member before a trigger can run. If
      // that grant were ever widened the guard would become the only cycle control
      // and these two facts would have to change together.
      for (const table of ['groups', 'roles']) {
        const writable = await client.query<{ insert: boolean; update: boolean }>(
          `SELECT has_table_privilege('app_member', $1, 'INSERT') AS insert,
                  has_table_privilege('app_member', $1, 'UPDATE') AS update`,
          [table],
        );
        expect(writable.rows[0]?.insert, `app_member can insert into ${table}, so the cycle guard is the only control`).toBe(false);
        expect(writable.rows[0]?.update, `app_member can update ${table}, so the cycle guard is the only control`).toBe(false);
      }
    },
    TIMEOUT,
  );
});

describe('W27 · the administrative floor: is_system_role and is_system_group are enforced', () => {
  it(
    'app_admin cannot delete a system role, and the row survives',
    async () => {
      // The finding these tests exist for: both columns were DECORATIVE. `app_admin`
      // holds DELETE on `roles` and `groups`, `DELETE ... WHERE is_system_role = true`
      // returned HTTP 204, and the row was gone. Nothing in `database/`, `src/` or
      // `test/` read either column, while the migration comment described them as "the
      // administrative floor". A control that does nothing and a comment that says it
      // does is the worst pair available.
      //
      // Executed through the escalation boundary rather than with psql, because that
      // is the path the attack arrives on and it is the one where `is_superuser` must
      // still read 'off'.
      const floor = queryAsSuperuser<{ id: string }>(
        `SELECT id FROM roles WHERE is_system_role = true ORDER BY name`,
      );
      expect(floor.length).toBeGreaterThan(0);

      await expect(
        asAdmin(async (admin) => admin.query('DELETE FROM roles WHERE is_system_role = true')),
      ).rejects.toThrow(/is a system row/);

      const survivors = queryAsSuperuser<{ count: number }>(
        `SELECT count(*)::int AS count FROM roles WHERE is_system_role = true`,
      )[0];
      expect(survivors?.count).toBe(floor.length);

      // 42501, not 23514, and the code is asserted separately from the message because
      // node-pg's `message` carries only the text: an authorization refusal and a
      // check-violation look identical in a log line without it.
      await expect(
        asAdmin(async (admin) => admin.query('DELETE FROM roles WHERE is_system_role = true')),
      ).rejects.toMatchObject({ code: '42501' });
    },
    TIMEOUT,
  );

  it(
    'app_admin cannot delete a system group, and the row survives',
    async () => {
      // The scope axis's half. Deleting a groups floor row unparents a subtree, which
      // is every scope decision in this schema resolved through.
      //
      // The probe row is created here rather than in the seed, because a floor group
      // that lives in the fixture is a floor group every later test has to work
      // around: it cannot be re-parented or renamed, which is exactly what the cycle
      // tests above need to do to their fixtures.
      const probe = 'floor-probe-group-floor';
      const created = attemptAsSuperuser([`INSERT INTO groups (name, is_system_group) VALUES ('${probe}', true)`]);
      expect(created.ok, `could not create the groups floor probe:\n${created.output}`).toBe(true);

      try {
        await expect(
          asAdmin(async (admin) => admin.query('DELETE FROM groups WHERE name = $1', [probe])),
        ).rejects.toThrow(/is a system row/);

        const after = queryAsSuperuser<{ count: number }>(
          `SELECT count(*)::int AS count FROM groups WHERE name = '${probe}'`,
        )[0];
        expect(after?.count).toBe(1);
      } finally {
        attemptAsSuperuser([`DELETE FROM groups WHERE name = '${probe}'`]);
      }
    },
    TIMEOUT,
  );

  it(
    'app_admin cannot clear the flag to make a system row deletable, which is the same act as deleting it',
    async () => {
      // The UPDATE half, and it is the one an UPDATE guard written naively misses: it
      // is tempting to check the NEW row instead of the OLD one, which permits exactly
      // this — flip the flag off, then delete — in two statements, or in one if the
      // caller is clever. The guard therefore asks about OLD.
      await expect(
        asAdmin(async (admin) => admin.query('UPDATE roles SET is_system_role = false WHERE is_system_role = true')),
      ).rejects.toThrow(/is a system row/);

      const probe = 'floor-probe-group-flag';
      const created = attemptAsSuperuser([`INSERT INTO groups (name, is_system_group) VALUES ('${probe}', true)`]);
      expect(created.ok, `could not create the groups floor probe:\n${created.output}`).toBe(true);

      try {
        await expect(
          asAdmin(async (admin) => admin.query('UPDATE groups SET is_system_group = false WHERE name = $1', [probe])),
        ).rejects.toThrow(/is a system row/);

        const stillSet = queryAsSuperuser<{ is_system_group: boolean }>(
          `SELECT is_system_group FROM groups WHERE name = '${probe}'`,
        )[0];
        expect(stillSet?.is_system_group, 'the flag was cleared').toBe(true);
      } finally {
        attemptAsSuperuser([`DELETE FROM groups WHERE name = '${probe}'`]);
      }

      // The seeded floor is intact, which is what "the row survives" means here.
      const flags = await client.query<{ roles: number }>(
        `SELECT (SELECT count(*)::int FROM roles WHERE is_system_role = true) AS roles`,
      );
      expect(flags.rows[0]?.roles).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    'a superuser session may remove the floor, and an ordinary owner role may not',
    () => {
      // The permitted half. A guard with no permitted path is a lockout, not a control,
      // and the provisioning path still has to work: a floor that cannot be lifted by
      // anyone is a floor that cannot be replaced on a migration.
      //
      // `is_superuser` and not `current_user` is the discriminator, and it is
      // asserted in both directions because the wrong choice fails silently: an
      // owner-session check would break the boundary path (the authenticator is not a
      // superuser) and a session_user check would not distinguish the two here.
      const asSuperuser = attemptAsSuperuser([
        `INSERT INTO roles (name, is_system_role) VALUES ('floor-probe-role', true)`,
        `DELETE FROM roles WHERE name = 'floor-probe-role'`,
      ]);
      expect(asSuperuser.ok, `a superuser could not remove the floor:\n${asSuperuser.output}`).toBe(true);
      expect(asSuperuser.output).toContain('DELETE 1');

      const groupProbe = attemptAsSuperuser([
        `INSERT INTO groups (name, is_system_group) VALUES ('floor-probe-group', true)`,
        `DELETE FROM groups WHERE name = 'floor-probe-group'`,
      ]);
      expect(groupProbe.ok, `a superuser could not remove the groups floor:\n${groupProbe.output}`).toBe(true);
      expect(groupProbe.output).toContain('DELETE 1');

      // The migration/owner role owns every table and is NOT a superuser, so it is
      // inside the guard. Stated rather than assumed: `app` has rolsuper = false and
      // rolbypassrls = false in this cluster, which is what makes this true.
      const ownerAttributes = queryAsSuperuser<{ rolsuper: boolean }>(
        `SELECT rolsuper FROM pg_roles WHERE rolname = '${OWNING_ROLE}'`,
      )[0];
      expect(ownerAttributes?.rolsuper, `${OWNING_ROLE} is a superuser, so this half proves nothing`).toBe(false);

      const leftovers = queryAsSuperuser<{ roles: number; groups: number }>(
        `SELECT
           (SELECT count(*)::int FROM roles  WHERE name LIKE 'floor-probe%') AS roles,
           (SELECT count(*)::int FROM groups WHERE name LIKE 'floor-probe%') AS groups`,
      )[0];
      expect(leftovers?.roles).toBe(0);
      expect(leftovers?.groups).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'the floor trigger does not stop ordinary writes, so it is a floor and not a lockout',
    async () => {
      // The permitted cases for the same trigger. A guard that refuses everything is
      // indistinguishable from a correct guard until something has to be written, and
      // "the admin can no longer create a group" is the failure this prevents.
      const written = await asAdmin(async (admin) =>
        admin.query<{ id: string }>(`INSERT INTO groups (name) VALUES ('floor-probe-ordinary') RETURNING id`),
      );
      expect(written.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);

      await asAdmin(async (admin) => {
        await admin.query('UPDATE groups SET name = $2 WHERE id = $1', [written.rows[0]?.id, 'floor-probe-renamed']);
        await admin.query('DELETE FROM groups WHERE id = $1', [written.rows[0]?.id]);
      });

      // INSERT of a floor row stays permitted, and that is a deliberate residual: the
      // floor has to be creatable, because the bootstrap installs it. Adding a floor
      // row is not the risk — removing one is.
      const added = await asAdmin(async (admin) =>
        admin.query<{ id: string }>(
          `INSERT INTO groups (name, is_system_group) VALUES ('floor-probe-new-floor', true) RETURNING id`,
        ),
      );
      expect(added.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
      await expect(
        asAdmin(async (admin) => admin.query('DELETE FROM groups WHERE name = $1', ['floor-probe-new-floor'])),
      ).rejects.toThrow(/is a system row/);

      // Removed through the superuser path the guard itself recognises, so this test
      // leaves no state behind for the exact-count assertions later in the suite.
      attemptAsSuperuser([`DELETE FROM groups WHERE name = 'floor-probe-new-floor'`]);
      const leftovers = queryAsSuperuser<{ count: number }>(
        `SELECT count(*)::int AS count FROM groups WHERE name LIKE 'floor-probe%'`,
      )[0];
      expect(leftovers?.count).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'TRUNCATE does not fire the floor trigger, and no serving role holds TRUNCATE either',
    async () => {
      // The hole the trigger cannot close, closed by the grant instead and asserted
      // here so it is a test rather than a comment: `TRUNCATE` bypasses row triggers
      // entirely, so `TRUNCATE roles` as app_admin would empty the whole capability
      // table past a guard that refuses every single-row DELETE.
      for (const role of ASSUMABLE_ROLES) {
        for (const table of ['roles', 'groups']) {
          const granted = await client.query<{ truncate: boolean }>(
            `SELECT has_table_privilege($1, $2, 'TRUNCATE') AS truncate`,
            [role, table],
          );
          expect(granted.rows[0]?.truncate, `${role} can TRUNCATE ${table}, which bypasses the floor trigger`).toBe(false);
        }
      }

      // And the trigger is attached to UPDATE and DELETE, not to INSERT — the one way
      // to discover the coverage is to read the catalog rather than the migration.
      const attached = await client.query<{ tgname: string; tgtype: number }>(
        `SELECT tgname, tgtype FROM pg_trigger
          WHERE tgrelid IN ('roles'::regclass, 'groups'::regclass)
            AND NOT tgisinternal
          ORDER BY tgname`,
      );
      const floorTriggers = attached.rows.filter((row) => row.tgname.endsWith('_no_system_row'));
      expect(floorTriggers.map((row) => row.tgname)).toEqual(['groups_no_system_row', 'roles_no_system_row']);

      // tgtype bit 1 = ROW, bit 4 = UPDATE, bit 8 = DELETE. Asserted as the number the
      // catalog reports so an edit that narrows or widens the coverage is visible.
      for (const row of floorTriggers) {
        const isRow = (row.tgtype & 1) === 1;
        const isUpdate = (row.tgtype & 16) === 16;
        const isDelete = (row.tgtype & 8) === 8;
        expect(isRow, `${row.tgname} is not FOR EACH ROW`).toBe(true);
        expect(isUpdate, `${row.tgname} no longer guards UPDATE`).toBe(true);
        expect(isDelete, `${row.tgname} no longer guards DELETE`).toBe(true);
      }
    },
    TIMEOUT,
  );
});

describe('W27 · the closure is not an API resource', () => {
  it(
    'org_closure is unreachable over HTTP and absent from the served spec',
    async () => {
      // A materialized view has no RLS and no policy, and PostgREST auto-publishes
      // every relation in the schemas it serves — under `openapi-mode =
      // "ignore-privileges"` the served spec advertises it REGARDLESS of grants. A
      // single GRANT SELECT served the whole org tree to an anonymous caller (measured).
      // The closure therefore lives in the `authz` schema, which is not in
      // db-schemas, and the grant the policy needs has no HTTP surface to escape to.
      const admin = mintToken(PROOF_JWT_SECRET, { role: 'app_admin', sub: USERS.administrator });

      const direct = await request(`${baseUrl()}/org_closure`, admin);
      expect(direct.status).toBe(404);

      const spec = await request(`${baseUrl()}/`, admin);
      expect(spec.status).toBe(200);
      expect(spec.body).not.toContain('org_closure');

      // And the capability tables that hold the permission matrix are the same
      // question: not published either, because app_member holds no read on them.
      const matrix = await request(`${baseUrl()}/role_permissions`, mintToken(PROOF_JWT_SECRET, {
        role: 'app_member',
        sub: USERS.euMember,
      }));
      expect(matrix.status).toBe(403);
    },
    TIMEOUT,
  );
});

describe('W27 · policy totality: a malformed or absent claim denies, and never errors', () => {
  it(
    'every claims shape a caller can send yields a clean denial for a member',
    () => {
      // A policy that ERRORS is a 500 on every request, which is both a denial of
      // service and an oracle. `actor()` catches the uuid cast precisely so that a
      // malformed `sub` is a denial rather than an internal error.
      const shapes: readonly (string | undefined)[] = [
        undefined,
        '',
        '{}',
        '[]',
        'null',
        '{"role":"app_member"}',
        '{"role":"app_member","sub":""}',
        '{"role":"app_member","sub":null}',
        '{"role":"app_member","sub":"not-a-uuid"}',
        '{"role":"app_member","sub":123}',
        '{"role":"app_member","sub":"00000000-0000-0000-0000-00000000dead"}',
        'not json at all',
      ];

      for (const shape of shapes) {
        expect(projectNamesVisibleTo('app_member', shape), `claims ${shape ?? '(unset)'} did not deny cleanly`).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'a malformed sub does not break an admin, because the admin branch does not depend on it',
    () => {
      // `OR` does not short-circuit past an expression that raises — both operands are
      // evaluated and the error wins — so this is the case a bare cast inside a policy
      // fails. actor() returns NULL instead of raising, which is what makes the policy
      // total.
      expect(projectNamesVisibleTo('app_admin', '{"role":"app_admin","sub":"not-a-uuid"}')).toHaveLength(
        GROUP_NAMES.length,
      );
    },
    TIMEOUT,
  );

  it(
    'a well-formed sub that matches no membership yields zero rows, not everything',
    async () => {
      // Distinct from a malformed claim: the cast succeeds and the membership lookup
      // is simply empty. A policy that treated "no match" as "no restriction" would
      // leak here, which is the failure this case exists to catch.
      const token = mintToken(PROOF_JWT_SECRET, {
        role: 'app_member',
        sub: '00000000-0000-0000-0000-00000000dead',
      });
      expect(await visibleProjectNames(token)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'a valid uuid that is not a membership, plus a forged admin field, still yields nothing',
    () => {
      const forged = JSON.stringify({
        sub: USERS.ukMember,
        role: 'app_member',
        is_admin: true,
        role_claim: 'app_admin',
      });
      expect(projectNamesVisibleTo('app_member', forged)).toEqual(['project-UK']);
    },
    TIMEOUT,
  );
});

describe('W27 · role attributes and posture: FORCE binds the owner and nothing else', () => {
  it(
    'every serving role is NOSUPERUSER and NOBYPASSRLS',
    async () => {
      // FORCE ROW LEVEL SECURITY closes the owner hole and nothing else. Verified on a
      // live install: a postgres session read 5 of 5 rows from a table with ENABLE +
      // FORCE and a working policy. These attributes are therefore the only thing
      // between a serving role and every row.
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
    'the group-scoped tables are ENABLEd and FORCEd',
    async () => {
      const posture = await client.query<{ relname: string; enabled: boolean; forced: boolean }>(
        `SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname IN ('projects', 'customers')
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
    'groups and user_groups are ENABLEd but deliberately NOT FORCEd, for measured reasons',
    async () => {
      // Both are read by the scope policy, and both must stay writable by the owner:
      //   groups    — REFRESH MATERIALIZED VIEW runs the view's query with the owner's
      //               privileges and RLS applies to the owner under FORCE. Measured: a
      //               FORCE'd groups plus a working policy, refreshed by the owner,
      //               wrote a closure of 1 row instead of 2. No error, half the tree.
      //   user_groups — there is no serving-role write grant at all, so the owner is
      //               the only writer; FORCE would refuse its own INSERTs.
      // Every REQUEST-serving role is still bound by both policies.
      const posture = await client.query<{ relname: string; enabled: boolean; forced: boolean }>(
        `SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname IN ('groups', 'user_groups')
          ORDER BY c.relname`,
      );

      expect(posture.rows).toHaveLength(2);
      for (const row of posture.rows) {
        expect(row.enabled, `${row.relname} has RLS disabled`).toBe(true);
        expect(row.forced, `${row.relname} is FORCEd`).toBe(false);
      }

      const member = await request(`${baseUrl()}/groups?select=name&order=name`, mintToken(PROOF_JWT_SECRET, {
        role: 'app_member',
        sub: USERS.euMember,
      }));
      expect(parseJsonArray(member.body).map((row) => row['name'])).toEqual(['EU', 'FR', 'UK']);
    },
    TIMEOUT,
  );

  it(
    'the owner is refused DML under FORCE, and DDL is unaffected',
    async () => {
      // What FORCE costs, stated as a fact rather than a caveat. The owner is subject
      // to its own policy, so a seeding INSERT with no claims is rejected. The
      // documented workaround — disabling row_security to seed — would reopen the
      // owner bypass and is used nowhere in this suite.
      await expect(client.query(`INSERT INTO projects (group_id, name) VALUES ($1, 'owner-insert')`, [GROUPS.eu]))
        .rejects.toThrow(/row-level security/i);

      // DDL is not subject to RLS, which is what makes FORCE usable at all.
      await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS ddl_probe integer');
      await client.query('ALTER TABLE projects DROP COLUMN ddl_probe');
    },
    TIMEOUT,
  );

  it(
    'seeding succeeds by assuming a role the policy admits, not by disabling row_security',
    async () => {
      // The sanctioned route, proven rather than asserted in a comment. The owner is
      // rejected above; assuming app_admin through the escalation boundary is
      // accepted. `SET row_security = off` would also make the insert succeed and is
      // never used, because it reopens the owner bypass for every later session on
      // that backend.
      const inserted = await asAdmin(async (admin) =>
        admin.query<{ id: string }>('INSERT INTO projects (group_id, name) VALUES ($1, $2) RETURNING id', [
          GROUPS.eu,
          'seeded-as-admin',
        ]),
      );

      expect(inserted.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);

      await asAdmin(async (admin) => {
        await admin.query(`DELETE FROM projects WHERE name = 'seeded-as-admin'`);
      });
    },
    TIMEOUT,
  );

  it(
    'SET row_security = off does not disable row-level security for a serving role; the write fails closed',
    () => {
      // The escape hatch that does not exist, asserted rather than asserted-against.
      //
      // `row_security` is a settable GUC with no privilege check, so any role can turn
      // it off — which sounds like a total bypass and is not. Postgres compares the
      // setting against whether the statement WOULD be subject to a policy, and
      // refuses: `query would be affected by row-level security policy for table`.
      // Fail-closed, on the write, with no data touched.
      //
      // Worth having as a test rather than a claim because the two plausible
      // alternatives are both bad: the setting silently doing nothing would make this
      // suite's "seeding never disables row_security" comment true for the wrong
      // reason, and a Postgres release that changed the behaviour would turn every
      // owner-side seeding path into a hole.
      for (const role of ['app_member', 'app_admin']) {
        const attempt = attemptAsRole(role, claimsFor(USERS.euMember, role), [
          'SET row_security = off',
          `INSERT INTO projects (group_id, name) VALUES ('${GROUPS.eu}', 'row-security-bypass')`,
        ]);

        expect(attempt.ok, `${role} disabled row-level security for a write:\n${attempt.output}`).toBe(false);
        expect(attempt.output).toMatch(/row-level security|row_security/i);
        expect(attempt.output).not.toContain('INSERT 0 1');
      }

      // Nothing was written by either attempt.
      const written = queryAsSuperuser<{ count: number }>(
        `SELECT count(*)::int AS count FROM projects WHERE name = 'row-security-bypass'`,
      )[0];
      expect(written?.count).toBe(0);

      // And the setting does not turn a filtered READ into an unfiltered one either,
      // which is the half that would actually matter. The refusal above is raised at
      // plan time for any statement a policy would govern, SELECT included — measured,
      // and worth stating because "row_security = off" reads like a way to see
      // everything and is not one.
      const read = attemptAsRole('app_member', claimsFor(USERS.euMember, 'app_member'), [
        'SET row_security = off',
        'SELECT count(*) FROM projects',
      ]);
      expect(read.ok, `a filtered read succeeded with row_security off:\n${read.output}`).toBe(false);
      expect(read.output).toMatch(/row-level security/);

      // And with the setting left alone, the same read works — the permitted case, so
      // the two above are refusals and not a lockout.
      const permittedRead = attemptAsRole('app_member', claimsFor(USERS.euMember, 'app_member'), [
        'SELECT count(*) FROM projects',
      ]);
      expect(permittedRead.ok, `an ordinary read failed:\n${permittedRead.output}`).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'a serving role cannot set session_replication_role = replica, which would silence every trigger',
    async () => {
      // `session_replication_role = replica` is the other half of the trigger story,
      // and it is the more dangerous one: in replica mode PostgreSQL fires ONLY
      // foreign-key triggers. `assert_group_acyclic`, `assert_role_acyclic`,
      // `protect_system_row` and `groups_refresh_closure` would all stop running — a
      // cycle guard that can be switched off, an administrative floor that can be
      // stepped over, and a closure that silently stops refreshing.
      //
      // It is a SUSET parameter, so it is refused at the privilege check rather than
      // by anything in this schema. Nothing in `database/`, `src/` or `test/` could
      // notice if that changed, which is why it is asserted here.
      const attempt = attemptAsRole('app_admin', claimsFor(USERS.administrator, 'app_admin'), [
        'SET session_replication_role = replica',
      ]);

      expect(attempt.ok, `app_admin silenced every trigger:\n${attempt.output}`).toBe(false);
      expect(attempt.output).toMatch(/permission denied to set parameter "session_replication_role"/);

      // Asserted from the catalog as well, so the test does not depend on the message
      // wording staying exactly this. A GRANT of this parameter is the change that
      // would reopen it.
      for (const role of ASSUMABLE_ROLES) {
        const allowed = await client.query<{ allowed: boolean }>(
          `SELECT has_parameter_privilege($1, 'session_replication_role', 'SET') AS allowed`,
          [role],
        );
        expect(allowed.rows[0]?.allowed, `${role} may SET session_replication_role`).toBe(false);
      }
    },
    TIMEOUT,
  );
});

describe('W27 · function privileges: EXECUTE is granted to PUBLIC by default', () => {
  it(
    'no function in either schema is executable by PUBLIC',
    async () => {
      // Postgres grants EXECUTE on a new function to PUBLIC by default. 7 of 9
      // functions in the earlier spike had a NULL proacl, so any helper was
      // anonymously reachable — and a SECURITY DEFINER helper is then an anonymous
      // privilege escalation, not just an information leak.
      const result = await client.query<{ proname: string; public_may_execute: boolean }>(
        `SELECT p.proname, has_function_privilege('public', p.oid, 'EXECUTE') AS public_may_execute
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname IN ('public', 'authz')
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
    'the helpers a policy evaluates are executable by every role whose requests evaluate it, app_anon included',
    async () => {
      // The revoke alone was worse than useless. An earlier version revoked EXECUTE
      // from PUBLIC and granted it to nobody, so every scoped request died with
      // `permission denied for function actor` and row scoping was 100%
      // non-functional. Both halves are required, and app_anon is included because a
      // policy expression is evaluated for every role that reaches the table.
      //
      // The set is exactly the two functions a POLICY calls, and it was derived from
      // pg_policies rather than from this file's own prose — which is the whole point
      // of the next test, which found that a third function was in this list and did
      // not belong in it.
      const result = await client.query<{ proname: string; anon: boolean; member: boolean; admin: boolean }>(
        `SELECT p.proname,
                has_function_privilege('app_anon',   p.oid, 'EXECUTE') AS anon,
                has_function_privilege('app_member', p.oid, 'EXECUTE') AS member,
                has_function_privilege('app_admin',  p.oid, 'EXECUTE') AS admin
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname IN ('actor', 'visible_group_ids')
          ORDER BY p.proname`,
      );

      expect(result.rows).toHaveLength(2);
      for (const row of result.rows) {
        expect(row.anon, `app_anon cannot execute ${row.proname}, so an unauthenticated read errors`).toBe(true);
        expect(row.member, `app_member cannot execute ${row.proname}`).toBe(true);
        expect(row.admin, `app_admin cannot execute ${row.proname}`).toBe(true);
      }

      // And the set really is the one the policies call, read from the catalog rather
      // than from the list above: a helper added to a policy without a matching grant
      // is the 42501-on-every-request failure this exists to prevent, and a helper
      // added to the GRANT list without being called by a policy is the anonymous
      // exposure the next test exists to prevent. Both directions are asserted, so the
      // list cannot be quietly wrong in either way.
      const calledByPolicies = await client.query<{ fn: string }>(
        `SELECT DISTINCT (regexp_matches(qual, '([a-z_]+)\\(', 'g'))[1] AS fn
           FROM pg_policies
          WHERE schemaname = 'public'
            AND qual IS NOT NULL`,
      );
      const helpers = calledByPolicies.rows.map((row) => row.fn);

      expect(helpers.sort()).toEqual(['actor', 'visible_group_ids']);
    },
    TIMEOUT,
  );

  it(
    'an anonymous caller cannot read the capability matrix through has_permission',
    async () => {
      // The grant was wrong, and the comment above it was wrong in a way that
      // mattered: it claimed `app_anon` was "not optional" because "a policy
      // expression is evaluated for EVERY role that reaches the table". True of
      // actor(). False here — no policy calls this function. So the grant was pure
      // exposure justified by an argument about a different function.
      //
      // What it cost, measured before the fix: `POST /rpc/has_permission` with no
      // token. Because `who` is an ARGUMENT, a sweep over (who, resource, action)
      // recovers any user's complete permission set, and the same call is an oracle
      // for "does this uuid hold any role with any capability". The whole sweep is run
      // here, because the attack is the SWEEP: a control that refuses one probe and
      // answers the next is not a control.
      const probes = PERMISSIONS.flatMap((permission) => {
        const [resource = '', action = ''] = permission.split('.');
        return [USERS.administrator, USERS.euMember, USERS.noRole].map((who) => ({ who, resource, action }));
      });
      expect(probes.length).toBeGreaterThan(1);

      const anonymous = mintToken(PROOF_JWT_SECRET, { role: 'app_anon', sub: USERS.administrator });

      const leaks: string[] = [];
      for (const probe of probes) {
        const response = await request(`${baseUrl()}/rpc/has_permission`, anonymous, {
          method: 'POST',
          body: JSON.stringify(probe),
        });
        // 401, not 403, and that is not a detail: PostgREST answers the ANONYMOUS role
        // with 401 for a privilege error, the same way it answers `permission denied
        // for table` — the anon role is by definition not authenticated, so 403 would
        // be the misleading answer. What distinguishes a real refusal from a pass is
        // the SQLSTATE in the body, which is asserted rather than the HTTP status,
        // for the same reason every other test in this file asserts on bodies.
        if (sqlStateOf(response.body) !== '42501' || !response.body.includes('permission denied for function has_permission')) {
          leaks.push(`${probe.who} ${probe.resource}.${probe.action} -> ${response.status} ${response.body}`);
        }
        // The oracle is closed too: not even a boolean leaks, true or false.
        if (/"(true|false)"/.test(response.body)) {
          leaks.push(`${probe.who} ${probe.resource}.${probe.action} leaked an answer: ${response.body}`);
        }
      }
      expect(leaks, `the anonymous capability sweep was not refused: ${leaks.join('; ')}`).toEqual([]);

      // One probe by name as well, because a failure message that names the exact
      // request is what a reader needs at 3am, and a loop over a derived list does
      // not produce one.
      const named = await request(`${baseUrl()}/rpc/has_permission`, anonymous, {
        method: 'POST',
        body: JSON.stringify({ who: USERS.administrator, resource: 'project', action: 'delete' }),
      });
      // The message matters: it names the FUNCTION, which is what makes this a test of
      // the GRANT rather than of a coincidental 403 — the table grants are a different
      // control with a different message.
      expect(named.status, `anonymous has_permission returned ${named.status}: ${named.body}`).toBe(401);
      expect(named.body).toContain('permission denied for function has_permission');
      expect(named.body).toContain('42501');

      // The catalog, which is the control rather than one consequence of it.
      const privileges = await client.query<{ anon: boolean; member: boolean; admin: boolean }>(
        `SELECT has_function_privilege('app_anon',   p.oid, 'EXECUTE') AS anon,
                has_function_privilege('app_member', p.oid, 'EXECUTE') AS member,
                has_function_privilege('app_admin',  p.oid, 'EXECUTE') AS admin
           FROM pg_proc p
          WHERE p.proname = 'has_permission'`,
      );
      expect(privileges.rows[0]?.anon, 'app_anon can execute has_permission').toBe(false);

      // The permitted cases, so this is a restriction and not a lockout: the
      // authenticated roles still resolve capabilities, which is what the per-user
      // capability surface is built on.
      expect(privileges.rows[0]?.member, 'app_member cannot execute has_permission').toBe(true);
      expect(privileges.rows[0]?.admin, 'app_admin cannot execute has_permission').toBe(true);

      const member = mintToken(PROOF_JWT_SECRET, { role: 'app_member', sub: USERS.administrator });
      expect(await rpcHasPermission(member, USERS.administrator, 'project', 'delete')).toBe(true);
      expect(await rpcHasPermission(member, USERS.noRole, 'project', 'delete')).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'the trigger functions are executable by nobody, because they are attached as triggers and not called',
    () => {
      // A SECURITY DEFINER trigger function reachable by a caller is a privilege
      // escalation with no legitimate use: nothing calls them. The owner is excluded
      // because REVOKE FROM PUBLIC materialises the owner's default privileges into
      // proacl, so the owner always appears there and means nothing.
      for (const name of ['assert_group_acyclic', 'assert_role_acyclic', 'refresh_org_closure']) {
        const row = queryAsSuperuser<{ executable_by: string }>(
          `SELECT string_agg(r.rolname, ',') AS executable_by
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
             JOIN pg_roles r ON r.oid = acl.grantee
            WHERE p.proname = '${name}'
              AND acl.privilege_type = 'EXECUTE'
              AND r.oid <> p.proowner`,
        )[0];
        expect(row?.executable_by ?? '', `${name} is reachable by a caller`).toBe('');
      }
    },
    TIMEOUT,
  );
});

describe('W27 · grant order, keys and idempotency', () => {
  it(
    'internal_notes IS readable when a column revoke is issued while table-level SELECT exists',
    async () => {
      // This test asserts the FAIL-OPEN behaviour, on purpose, in a transaction that
      // is always rolled back. It is the regression guard for the comment above the
      // grants in the migration: a column grant can only narrow a table grant that
      // has already been taken away. It cannot subtract from one. A migration that
      // reorders those two statements loses the column silently — no error, no
      // warning, HTTP 200 with the value intact.
      await client.query('BEGIN');
      try {
        await client.query('REVOKE ALL ON customers FROM app_member');
        await client.query('GRANT SELECT, INSERT ON customers TO app_member');
        await client.query('GRANT SELECT (group_id, id, name, created_at) ON customers TO app_member');
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
      // The order the migration uses, asserted so the test above and this one cannot
      // both be "right" by accident.
      await client.query('BEGIN');
      try {
        await client.query('REVOKE ALL ON customers FROM app_member');
        await client.query('GRANT SELECT, INSERT ON customers TO app_member');
        await client.query('REVOKE SELECT ON customers FROM app_member');
        await client.query('GRANT SELECT (group_id, id, name, created_at) ON customers TO app_member');

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
    'every scoped table takes PRIMARY KEY (group_id, id) and a secondary index on id',
    async () => {
      // The composite key is doing security work: "this row belongs to a group" is
      // part of the row's identity, so a UNIQUE violation is itself group-scoped. The
      // secondary index on id keeps a single-column lookup on an index.
      for (const table of ['projects', 'customers']) {
        const primaryKey = await client.query<{ columns: string }>(
          `SELECT string_agg(att.attname, ',' ORDER BY att.attname) AS columns
             FROM pg_constraint c
             JOIN unnest(c.conkey) WITH ORDINALITY AS key(attnum, position) ON true
             JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = key.attnum
            WHERE c.conrelid = $1::regclass AND c.contype = 'p'`,
          [table],
        );
        expect(primaryKey.rows[0]?.columns, `${table} primary key`).toBe('group_id,id');

        const indexed = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count
             FROM pg_index i
             JOIN pg_class c ON c.oid = i.indexrelid
            WHERE i.indrelid = $1::regclass
              AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                     FROM unnest(i.indkey) AS k(attnum)
                     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                   LIMIT 1) = ARRAY['id']::text[]`,
          [table],
        );
        expect(Number(indexed.rows[0]?.count ?? 0), `${table} has no index on id alone`).toBeGreaterThan(0);
      }
    },
    TIMEOUT,
  );

  it(
    'every foreign key on a scoped table carries group_id, so no FK leaves the scoped set',
    () => {
      // Referential-integrity checks are constraint triggers that run OUTSIDE any
      // policy: they bypass RLS and fail OPEN. A plain FK is therefore an existence
      // oracle (success versus 23503 reveals any group id, including out-of-scope
      // ones) and ON DELETE CASCADE is a write across RLS. This is a design
      // constraint, not something a policy can fix, so it is asserted structurally.
      const offenders = queryAsSuperuser<{ conname: string; columns: string }>(
        `SELECT c.conname,
                (SELECT string_agg(a.attname::text, ',' ORDER BY a.attname)
                   FROM unnest(c.conkey) AS k(attnum)
                   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public'
            AND t.relname IN ('projects', 'customers')
            AND c.contype = 'f'
            AND NOT (
              SELECT array_agg(a.attname::text ORDER BY a.attname)
                FROM unnest(c.conkey) AS k(attnum)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
            ) @> ARRAY['group_id']::text[]`,
      );

      expect(offenders).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'the migration applies twice in a row without changing any grant',
    async () => {
      // Idempotency is a separate claim from "applies cleanly", and a grant that only
      // survives the first application is a grant that will be lost on the next deploy.
      // The fixture already applied the migration twice; this asserts the resulting
      // privileges rather than the exit code.
      const before = await snapshotPrivileges();
      applyMigrationAsOwner();
      const after = await snapshotPrivileges();

      expect(after).toEqual(before);
    },
    TIMEOUT,
  );
});

async function snapshotPrivileges(): Promise<string> {
  const result = await client.query<{ grantee: string; table_name: string; privilege_type: string }>(
    `SELECT grantee, table_name, privilege_type
       FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
      ORDER BY grantee, table_name, privilege_type`,
  );
  return JSON.stringify(result.rows);
}