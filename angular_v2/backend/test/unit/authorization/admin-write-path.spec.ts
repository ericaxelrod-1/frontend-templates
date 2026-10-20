import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_PROOF_DATABASE,
  authenticatorClient,
  dropProofDatabase,
  ownerClient,
  rebuildProofDatabase,
} from '../notifications/proof-database.js';

/**
 * The administration of the two authorization axes, against a REAL PostgreSQL.
 *
 * ## WHAT THIS FILE IS FOR
 *
 * The unit brief for this work asked one question the rest of the repository could
 * not answer by reading: **does the database refuse a cycle in the group
 * hierarchy, and with what error?** It is a question about a trigger, a policy and a
 * recursive walk, and a JSON fixture cannot answer any of it — the same reason
 * `test/unit/consent/consent-model.spec.ts` runs against a real server rather than
 * against a mock.
 *
 * So this suite builds the real thing: every shipped migration, applied to a
 * throwaway database, and then the actual statements an administrator's browser
 * sends. The group tree, the membership rows and the permission matrix are all real
 * rows, and the refusals below are refusals the database produced.
 *
 * ## THE ANSWER, STATED HERE SO A READER DOES NOT HAVE TO DERIVE IT
 *
 * **The database refuses it.** `assert_group_acyclic()` is a `BEFORE … FOR EACH ROW`
 * trigger on `groups` (`0001_rls_foundation.sql`), it raises with **SQLSTATE 23514**
 * (`check_violation`) and the message names what was refused:
 *
 *     group cycle: <group> cannot be parented to <parent>, which is itself or a
 *     descendant of <group>
 *
 * The refusal is made by the DATABASE, not by the application: nothing in the
 * application layer is asked whether a move is legal, and the assertion below is
 * made against the server's own answer.
 *
 * ## WHY THE FIXTURE IS CLAIMLESS AND THE ASSERTIONS ARE NOT
 *
 * The fixture is created through the escalation boundary as `app_admin` with NO
 * claims, which is what `database/seed.ts` does and what makes
 * `assert_grant_subset()`'s second branch (`current_setting('role') =
 * 'app_admin'`) apply. The ASSERTIONS run with claims, because that is what a
 * request carries: `authz.actor()` is then the administrator's own id, and the
 * grant-subset check runs its third branch — the actor's own effective permission
 * set against the set being conferred. That branch is the one the administration
 * surface actually meets, and it is vacuous for a grantor who already holds what
 * it confers, which is why the administrator here holds EVERY permission: an
 * administrator who conferred a capability it did not hold would be refused, and
 * that is the rule working, not a defect in the fixture.
 *
 * ## EVERY CASE OWNS ITS OWN SUBJECT
 *
 * Nothing is cleaned up inside the database, for the reason the consent proof gives:
 * the table under test carries the controls, and a suite that cleaned up by
 * deleting rows would be asserting the control and depending on its absence at the
 * same time. The database itself is dropped in `afterAll`, and that drop is the only
 * cleanup — it is a throwaway one.
 */

const DB = AUTHORIZATION_PROOF_DATABASE;

/** The fixture's rows, by id. */
interface Fixture {
  readonly adminId: string;
  readonly memberId: string;
  readonly outsiderId: string;
  readonly rootId: string;
  readonly euId: string;
  readonly frId: string;
  readonly managerRoleId: string;
}

let fixture: Fixture;

/**
 * The fixture's ids, hoisted out of the `beforeAll` block that creates them.
 *
 * They are `let` rather than `const` inside the block because the one row the
 * OWNER creates (below) needs two of them, and the owner is a different
 * connection from the one that created them.
 */
let adminId: string;
let memberId: string;
let outsiderId: string;
let rootId: string;
let euId: string;
let frId: string;
let managerRoleId: string;

/**
 * A statement that was refused, reported rather than thrown.
 *
 * "this was refused" is not expressible by a helper that reports a refusal as an
 * exception and says nothing about WHICH refusal it was — and here the code is the
 * whole assertion: `23514` is the acyclicity trigger, `42501` is the grant. A
 * helper that reported only the message would pass against the wrong control.
 */
async function refusalOf(
  work: () => Promise<unknown>,
): Promise<{ readonly code: string; readonly message: string }> {
  try {
    await work();
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    if (failure.code !== undefined) {
      return { code: failure.code, message: failure.message ?? '' };
    }
    throw error;
  }
  throw new Error('the statement was accepted, so there is no refusal to report');
}

/**
 * One transaction, through the escalation boundary, as `role`.
 *
 * `SET LOCAL ROLE` is the boundary the seed and the thin app both use, and the
 * `request.jwt.claims` GUC is what `authz.actor()` reads — the two together are
 * what a request looks like to the database.
 */
async function asRole<T>(
  role: string,
  sub: string | null,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await authenticatorClient(DB);
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    if (sub !== null) {
      await client.query('SELECT set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub, role }),
      ]);
    }
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** The administrator, as a request: `app_admin`, with claims. */
function asAdmin<T>(sub: string, work: (client: Client) => Promise<T>): Promise<T> {
  return asRole('app_admin', sub, work);
}

/** A member, as a request: `app_member`, with claims. */
function asMember<T>(sub: string, work: (client: Client) => Promise<T>): Promise<T> {
  return asRole('app_member', sub, work);
}

/** The first column of the first row, as a string. */
async function scalar<T extends Record<string, unknown>>(
  client: Client,
  sql: string,
  values: readonly unknown[] = [],
): Promise<T> {
  const result = await client.query<T>(sql, [...values]);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`the query returned no row: ${sql}`);
  }
  return row;
}

/** The id of the row the statement created or found. */
async function idOf(
  client: Client,
  sql: string,
  values: readonly unknown[] = [],
): Promise<string> {
  const row = await scalar<{ readonly id: string }>(client, sql, values);
  return row.id;
}

beforeAll(async () => {
  await rebuildProofDatabase(DB);

  // The fixture is built CLAIMLESS, through the boundary, exactly as the seed
  // builds its own: `authz.actor()` is NULL there, so `assert_grant_subset()` takes
  // its provisioning branch and the administrative floor's INSERT carve-out applies.
  const client = await authenticatorClient(DB);
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_admin');

    adminId = await idOf(
      client,
      `INSERT INTO public.users (username, email, password_hash)
       VALUES ('aa-admin', 'aa-admin@example.test', 'x') RETURNING id`,
    );
    memberId = await idOf(
      client,
      `INSERT INTO public.users (username, email, password_hash)
       VALUES ('aa-member', 'aa-member@example.test', 'x') RETURNING id`,
    );
    outsiderId = await idOf(
      client,
      `INSERT INTO public.users (username, email, password_hash)
       VALUES ('aa-outsider', 'aa-outsider@example.test', 'x') RETURNING id`,
    );

    await client.query(
      `INSERT INTO public.actions (name) VALUES ('read'), ('create') ON CONFLICT (name) DO NOTHING`,
    );
    const projectRead = await idOf(
      client,
      `INSERT INTO public.permissions (resource, action_id) VALUES ('project', 'read') RETURNING id`,
    );
    const customerRead = await idOf(
      client,
      `INSERT INTO public.permissions (resource, action_id) VALUES ('customer', 'read') RETURNING id`,
    );

    const adminRoleId = await idOf(
      client,
      `INSERT INTO public.roles (name, parent_id) VALUES ('aa-admin-role', NULL) RETURNING id`,
    );
    managerRoleId = await idOf(
      client,
      `INSERT INTO public.roles (name, parent_id) VALUES ('aa-manager-role', $1) RETURNING id`,
      [adminRoleId],
    );

    // The administrator holds EVERY permission, the way the seeded `admin` role
    // does. That is what makes the grant-subset check pass for a grant the
    // administrator confers, and it is the property the seed's own comment calls
    // "the superset stays a superset".
    await client.query(
      `INSERT INTO public.role_permissions (role_id, permission_id) VALUES ($1, $2), ($1, $3)`,
      [adminRoleId, projectRead, customerRead],
    );
    await client.query(
      `INSERT INTO public.role_permissions (role_id, permission_id) VALUES ($1, $2)`,
      [managerRoleId, projectRead],
    );
    await client.query(
      `INSERT INTO public.user_roles (user_id, role_id) VALUES ($1, $2), ($3, $4)`,
      [adminId, adminRoleId, memberId, managerRoleId],
    );

    // The tree: a root, a child, and a grandchild. The grandchild is the point —
    // it is what makes a re-parent a CYCLE rather than a sideways move.
    rootId = await idOf(
      client,
      `INSERT INTO public.groups (name, parent_id) VALUES ('aa-root', NULL) RETURNING id`,
    );
    euId = await idOf(
      client,
      `INSERT INTO public.groups (name, parent_id) VALUES ('aa-eu', $1) RETURNING id`,
      [rootId],
    );
    frId = await idOf(
      client,
      `INSERT INTO public.groups (name, parent_id) VALUES ('aa-fr', $1) RETURNING id`,
      [euId],
    );

    await client.query('COMMIT');
    fixture = { adminId, memberId, outsiderId, rootId, euId, frId, managerRoleId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  // The one fixture row the OWNER creates, and the reason it is created by the
  // owner: this suite asserts that `app_admin` may write a membership row, so a
  // fixture that created it through the boundary as `app_admin` would depend on
  // the grant under test. Removing that grant would fail the fixture in
  // `beforeAll` and leave every assertion in this file SKIPPED rather than failed
  // — a red exit code wearing eleven green tests, which is the false green
  // `AGENTS.md` §B8 forbids. The owner depends on nothing the suite tests, so the
  // assertions that do depend on it go red on their own.
  const owner = await ownerClient(DB);
  try {
    await owner.query(`INSERT INTO public.user_groups (user_id, group_id) VALUES ($1, $2)`, [
      memberId,
      euId,
    ]);
  } finally {
    await owner.end();
  }
}, 300_000);

afterAll(() => {
  dropProofDatabase(DB);
});

describe('the group hierarchy refuses a cycle in the DATABASE, and names what it refused', () => {
  it('refuses to make a group a descendant of itself, with a check violation that names the group and the refused parent', async () => {
    // `aa-root` is the ancestor of `aa-eu`, so parenting `aa-root` to `aa-eu` would
    // close a loop. This is the statement an administrator's browser sends when it
    // moves a group under one of its own descendants.
    const refusal = await refusalOf(() =>
      asAdmin(fixture.adminId, (client) =>
        client.query(`UPDATE public.groups SET parent_id = $1 WHERE id = $2`, [
          fixture.euId,
          fixture.rootId,
        ]),
      ),
    );

    // The SQLSTATE is the assertion: `23514` is `check_violation`, which is what the
    // acyclicity trigger raises. A refusal for any other reason — a policy, a
    // foreign key, a grant — would carry a different code and would not be this
    // control.
    expect(refusal.code).toBe('23514');
    // And the message names WHAT was refused, in the words the database uses.
    expect(refusal.message).toMatch(/group cycle/i);
    expect(refusal.message).toContain(fixture.rootId);
    expect(refusal.message).toContain(fixture.euId);
  });

  it('leaves the row unchanged, so a refused move does not half-apply', async () => {
    const parent = await asAdmin(fixture.adminId, async (client) => {
      const row = await scalar<{ readonly parent_id: string | null }>(
        client,
        `SELECT parent_id FROM public.groups WHERE id = $1`,
        [fixture.rootId],
      );
      return row.parent_id;
    });

    expect(parent).toBeNull();
  });

  it('refuses to make a group its own parent, which is the trivial case of the same rule', async () => {
    const refusal = await refusalOf(() =>
      asAdmin(fixture.adminId, (client) =>
        client.query(`UPDATE public.groups SET parent_id = $1 WHERE id = $1`, [fixture.euId]),
      ),
    );

    expect(refusal.code).toBe('23514');
    expect(refusal.message).toMatch(/group cycle/i);
  });

  it('accepts a move that does not close a loop, so the control is not simply refusing everything', async () => {
    // A control that refuses every move is indistinguishable from a broken one, and
    // the positive case is what tells the two apart. `aa-fr` moves from under `aa-eu`
    // to under `aa-root`: still acyclic, so it is admitted.
    await asAdmin(fixture.adminId, (client) =>
      client.query(`UPDATE public.groups SET parent_id = $1 WHERE id = $2`, [
        fixture.rootId,
        fixture.frId,
      ]),
    );

    const parent = await asAdmin(fixture.adminId, async (client) => {
      const row = await scalar<{ readonly parent_id: string | null }>(
        client,
        `SELECT parent_id FROM public.groups WHERE id = $1`,
        [fixture.frId],
      );
      return row.parent_id;
    });

    expect(parent).toBe(fixture.rootId);
  });
});

describe('the membership write path the administration surface uses', () => {
  it('lets the administrator add a member to a group', async () => {
    // The statement PostgREST sends for `POST /user_groups` with an `app_admin`
    // token. It is admitted because `0031_admin_membership_write.sql` grants the
    // superset principal the write and the `row_scope` policy admits it.
    await asAdmin(fixture.adminId, (client) =>
      client.query(`INSERT INTO public.user_groups (user_id, group_id) VALUES ($1, $2)`, [
        fixture.outsiderId,
        fixture.frId,
      ]),
    );

    const count = await asAdmin(fixture.adminId, async (client) => {
      const row = await scalar<{ readonly count: number }>(
        client,
        `SELECT count(*)::int AS count FROM public.user_groups
          WHERE user_id = $1 AND group_id = $2`,
        [fixture.outsiderId, fixture.frId],
      );
      return row.count;
    });

    expect(count).toBe(1);
  });

  it('lets the administrator remove that member again', async () => {
    await asAdmin(fixture.adminId, (client) =>
      client.query(`DELETE FROM public.user_groups WHERE user_id = $1 AND group_id = $2`, [
        fixture.outsiderId,
        fixture.frId,
      ]),
    );

    const count = await asAdmin(fixture.adminId, async (client) => {
      const row = await scalar<{ readonly count: number }>(
        client,
        `SELECT count(*)::int AS count FROM public.user_groups
          WHERE user_id = $1 AND group_id = $2`,
        [fixture.outsiderId, fixture.frId],
      );
      return row.count;
    });

    expect(count).toBe(0);
  });

  it('refuses a member writing their own membership, which is the control the grant protects', async () => {
    // The reason `0031` grants the write to `app_admin` and to nobody else: a
    // member who can write their own membership row widens their own scope in one
    // statement, and the scope policy honours it because it reads the table the
    // caller just wrote.
    const refusal = await refusalOf(() =>
      asMember(fixture.memberId, (client) =>
        client.query(`INSERT INTO public.user_groups (user_id, group_id) VALUES ($1, $2)`, [
          fixture.memberId,
          fixture.frId,
        ]),
      ),
    );

    expect(refusal.code).toBe('42501');
    expect(refusal.message).toMatch(/user_groups/i);
  });
});

describe('the grants this administration depends on, read from the live catalog', () => {
  it('grants the superset principal the membership write and no other serving role', async () => {
    // Read from `pg_class`, not from the migration file: the question is what the
    // DATABASE grants, and the seed's own `grantSeedAccess()` adds grants of its
    // own, so a file could say one thing and the catalog another.
    const client = await authenticatorClient(DB);
    try {
      const row = await scalar<{
        readonly admin_insert: boolean;
        readonly admin_delete: boolean;
        readonly member_insert: boolean;
        readonly member_update: boolean;
        readonly member_delete: boolean;
        readonly anon_insert: boolean;
        readonly member_select: boolean;
      }>(
        client,
        `SELECT has_table_privilege('app_admin', 'public.user_groups', 'INSERT')  AS admin_insert,
                has_table_privilege('app_admin', 'public.user_groups', 'DELETE')  AS admin_delete,
                has_table_privilege('app_member', 'public.user_groups', 'INSERT') AS member_insert,
                has_table_privilege('app_member', 'public.user_groups', 'UPDATE') AS member_update,
                has_table_privilege('app_member', 'public.user_groups', 'DELETE') AS member_delete,
                has_table_privilege('app_anon', 'public.user_groups', 'INSERT')   AS anon_insert,
                has_table_privilege('app_member', 'public.user_groups', 'SELECT') AS member_select`,
      );

      expect(row.admin_insert).toBe(true);
      expect(row.admin_delete).toBe(true);
      expect(row.member_insert).toBe(false);
      expect(row.member_update).toBe(false);
      expect(row.member_delete).toBe(false);
      expect(row.anon_insert).toBe(false);
      // The read is NOT withdrawn: the scope policy reads this table with the
      // querying role's privileges, so a member with no read on it cannot have a
      // scoped read evaluated at all.
      expect(row.member_select).toBe(true);
    } finally {
      await client.end();
    }
  });
});

describe('the two axes, and what revoking a role does to them', () => {
  it('resolves a member’s capability from the role hierarchy, not from their group', async () => {
    const held = await asAdmin(fixture.adminId, async (client) => {
      const row = await scalar<{ readonly held: boolean }>(
        client,
        `SELECT has_permission($1, 'project', 'read') AS held`,
        [fixture.memberId],
      );
      return row.held;
    });

    expect(held).toBe(true);
  });

  it('changes the member’s capability when the role is revoked, and leaves their scope untouched', async () => {
    // The scope half is a membership row and the capability half is a role row, and
    // revoking the role changes ONE of them. That is the whole of §B2: the two
    // axes are independent, and a screen that collapses them would be showing a
    // capability the database does not resolve.
    await asAdmin(fixture.adminId, (client) =>
      client.query(`DELETE FROM public.user_roles WHERE user_id = $1 AND role_id = $2`, [
        fixture.memberId,
        fixture.managerRoleId,
      ]),
    );

    const after = await asAdmin(fixture.adminId, async (client) => {
      const capability = await scalar<{ readonly held: boolean }>(
        client,
        `SELECT has_permission($1, 'project', 'read') AS held`,
        [fixture.memberId],
      );
      const scope = await scalar<{ readonly count: number }>(
        client,
        `SELECT count(*)::int AS count FROM public.user_groups WHERE user_id = $1`,
        [fixture.memberId],
      );
      return { held: capability.held, scope: scope.count };
    });

    expect(after.held).toBe(false);
    // The membership is still there: the scope did not move.
    expect(after.scope).toBe(1);
  });

  it('lets the administrator confer a role, because the administrator holds every permission', async () => {
    // The third branch of `assert_grant_subset()`: the conferred set is the
    // effective closure of the role being assigned, and the actor's own set must
    // contain it. The administrator holds every permission, so it does — and a
    // grantor that did NOT hold the capability would be refused, which is that
    // control working.
    await asAdmin(fixture.adminId, (client) =>
      client.query(`INSERT INTO public.user_roles (user_id, role_id) VALUES ($1, $2)`, [
        fixture.outsiderId,
        fixture.managerRoleId,
      ]),
    );

    const held = await asAdmin(fixture.adminId, async (client) => {
      const row = await scalar<{ readonly held: boolean }>(
        client,
        `SELECT has_permission($1, 'project', 'read') AS held`,
        [fixture.outsiderId],
      );
      return row.held;
    });

    expect(held).toBe(true);
  });
});
