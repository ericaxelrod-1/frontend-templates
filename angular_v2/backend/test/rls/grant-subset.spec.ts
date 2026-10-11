import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { loadTestEnvironment } from '../support/database.js';
import { BACKEND_ROOT } from '../support/paths.js';
import {
  attemptAsSuperuser,
  authenticatorClient,
  claimsFor,
  dropProofDatabase,
  ownerClient,
  proofDatabase,
  rebuildDatabase,
  ROLES,
  seed,
  USERS,
} from './support/fixture.js';

/**
 * W08b — the grant-subset invariant: a writer of `role_permissions` or
 * `user_roles` may not confer a capability it does not itself hold, enforced by
 * the `assert_grant_subset()` trigger in `0004_grant_subset.sql`.
 *
 * THE FIXTURE SHAPE, stated because it is not the shipped one. In the shipped
 * grants only `app_admin` holds `INSERT` on the two grant tables, and app_admin
 * is the superset principal, so the subset path is unreachable from the request
 * surface today — documented defect (i) in the migration, and the reason this
 * suite WIDENS the grants: `app_member` is given `INSERT, UPDATE` on both
 * tables for the duration of the run, which is exactly the future state the
 * trigger exists for. Every probe then goes through the escalation boundary as
 * `app_member` with `request.jwt.claims` set — the request-path shape. The
 * widening is revoked in `afterAll`.
 *
 * Assertions name the control that fired: the SQLSTATE (`42501` is also what a
 * missing table grant raises) AND the message prefix `grant-subset`, so a
 * denial by the wrong mechanism cannot read as a pass. Positive cases assert
 * the row landed, because a capability check that denies everyone looks exactly
 * like one that works.
 */

const TIMEOUT = 120_000;

const GRANT_SUBSET_SQL = join(BACKEND_ROOT, 'database', 'migrations', '0004_grant_subset.sql');

/** The principal the shipped grants withhold writes from — the attack's shape. */
const GRANTEE = 'app_member';

/** Users created by these tests; fixed ids so the assertions can name them. */
const PROBE_USERS = {
  grantedViewer: '99999999-0000-0000-0000-000000000001',
  grantedManager: '99999999-0000-0000-0000-000000000002',
  grantedAdministrator: '99999999-0000-0000-0000-000000000003',
} as const;

interface Attempt {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Applies 0004 as the owner role, the same way the fixture applies 0001. Run
 * twice for the same reason 0001 is applied twice: "applies cleanly" and "is
 * idempotent" are different claims.
 */
function applyGrantSubsetMigration(): void {
  const config = loadTestEnvironment().database;
  const result = spawnSync(
    'psql',
    ['-v', 'ON_ERROR_STOP=1', '-q', '-h', config.host, '-U', config.user, '-d', proofDatabase(), '-f', GRANT_SUBSET_SQL],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: config.password } },
  );
  if (result.status !== 0) {
    throw new Error(`applying 0004_grant_subset as ${config.user} failed:\n${result.stderr}`);
  }
}

/**
 * Runs one write through the escalation boundary — `pgrst_authenticator`
 * assuming `role`, with the claims GUC set — and reports refusal rather than
 * throwing. `claims === undefined` leaves the GUC untouched: the no-identity
 * shape.
 *
 * This must NOT go through a superuser session (the way `attemptAsRole` does):
 * the trigger's out-of-band branch passes superuser sessions unconditionally,
 * so a sudo-psql probe would test the wrong branch of the control.
 */
async function attemptWrite(role: 'app_member' | 'app_admin', claims: string | undefined, sql: string): Promise<Attempt> {
  const client = authenticatorClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    if (claims !== undefined) {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims]);
    }
    await client.query(sql);
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const pgError = error as { code?: unknown; message?: unknown };
    return {
      ok: false,
      code: typeof pgError.code === 'string' ? pgError.code : undefined,
      message: typeof pgError.message === 'string' ? pgError.message : undefined,
    };
  } finally {
    await client.end();
  }
}

/** A row count over the grant tables, read as the owner. */
async function countGrantRows(sql: string): Promise<number> {
  const owner = ownerClient();
  await owner.connect();
  try {
    const result = await owner.query<{ count: number }>(sql);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('count query returned no row');
    }
    return row.count;
  } finally {
    await owner.end();
  }
}

/** ukMember holds the viewer role: project.read and page.read, nothing else. */
const memberClaims = claimsFor(USERS.ukMember, 'app_member');

let projectRead: string;
let projectDelete: string;

beforeAll(async () => {
  rebuildDatabase();
  applyGrantSubsetMigration();
  applyGrantSubsetMigration();

  // Seeded AFTER the trigger exists: the fixture's capability writes go through
  // the boundary as app_admin with no claims, so seeding itself proves the
  // provisioning branch admits the superset principal without an identity.
  await seed();

  const owner = ownerClient();
  await owner.connect();
  try {
    const permissions = await owner.query<{ id: string; action_id: string }>(
      `SELECT id, action_id FROM permissions WHERE resource = 'project' AND action_id IN ('read', 'delete')`,
    );
    for (const row of permissions.rows) {
      if (row.action_id === 'read') {
        projectRead = row.id;
      }
      if (row.action_id === 'delete') {
        projectDelete = row.id;
      }
    }
    if (projectRead === undefined || projectDelete === undefined) {
      throw new Error('the seeded project.read / project.delete permission rows were not found');
    }

    // The widened state the trigger defends (see the file header). Revoked in
    // afterAll; if the run dies first, the proof database is rebuilt by the
    // next suite that touches it, so the widening cannot leak into another
    // spec's fixture.
    await owner.query(`GRANT INSERT, UPDATE ON role_permissions, user_roles TO ${GRANTEE}`);
  } finally {
    await owner.end();
  }
}, TIMEOUT);

afterAll(async () => {
  // `rebuildDatabase` set a CLUSTER-scoped password on pgrst_authenticator, and
  // `pgrst_authenticator` is not a member of this cluster's throwaway database's
  // world — it is a role on the whole cluster. Without this the next `npm run dev`
  // cannot mint a token. Same reason as in rls.spec.ts: check the cluster, not
  // the diff.
  //
  // The REVOKE below is the teardown for a GRANT this suite deliberately widened,
  // and it is kept exactly as it was. It is also the step that can throw first:
  // `ownerClient()` targets `rls_proof`, which an earlier or parallel failure may
  // already have dropped, so `await owner.connect()` can refuse before the
  // restore ever runs — which is precisely the situation `afterAll` exists for.
  // Wrapped so the cluster-scoped restore cannot be sequenced behind it, with the
  // `finally` nested so the proof database is still dropped if the restore fails.
  try {
    const owner = ownerClient();
    await owner.connect();
    try {
      await owner.query(`REVOKE INSERT, UPDATE ON role_permissions, user_roles FROM ${GRANTEE}`);
    } finally {
      await owner.end();
    }
  } finally {
    try {
      restoreAuthenticatorPassword();
    } finally {
      dropProofDatabase();
    }
  }
});

describe('W08b · grant-subset: a writer cannot confer a capability it does not hold', () => {
  it(
    'a grantor holding project.read cannot attach project.delete to a role — 42501 and the row is absent',
    async () => {
      // The attack the invariant names: the grantor's effective set is
      // {project.read, page.read}, and the write confers project.delete.
      const attempt = await attemptWrite(
        GRANTEE,
        memberClaims,
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ('${ROLES.contributor}', '${projectDelete}')`,
      );

      // Both halves: 42501 is also what a missing table grant raises, so the
      // message is what proves the TRIGGER fired rather than the grant layer.
      expect(attempt.ok).toBe(false);
      expect(attempt.code).toBe('42501');
      expect(attempt.message).toContain('grant-subset');

      expect(
        await countGrantRows(
          `SELECT count(*)::int AS count FROM role_permissions WHERE role_id = '${ROLES.contributor}' AND permission_id = '${projectDelete}'`,
        ),
      ).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'a grantor holding project.read CAN attach project.read to a role — the positive case',
    async () => {
      // Denial-only tests pass against a control that refuses everything; this
      // is the case that sees that defect.
      const attempt = await attemptWrite(
        GRANTEE,
        memberClaims,
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ('${ROLES.contributor}', '${projectRead}')`,
      );
      expect(attempt.ok, `expected success, got ${attempt.code}: ${attempt.message}`).toBe(true);

      expect(
        await countGrantRows(
          `SELECT count(*)::int AS count FROM role_permissions WHERE role_id = '${ROLES.contributor}' AND permission_id = '${projectRead}'`,
        ),
      ).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'a grantor cannot assign a role whose effective permission set exceeds its own — 42501',
    async () => {
      // The manager role's closure is {project.update, project.delete} plus the
      // inherited contributor and viewer rows; the grantor holds only the
      // viewer set, so six permissions are conferred and four of them are ones
      // the grantor lacks.
      const attempt = await attemptWrite(
        GRANTEE,
        memberClaims,
        `INSERT INTO user_roles (user_id, role_id) VALUES ('${PROBE_USERS.grantedManager}', '${ROLES.manager}')`,
      );

      expect(attempt.ok).toBe(false);
      expect(attempt.code).toBe('42501');
      expect(attempt.message).toContain('grant-subset');

      expect(
        await countGrantRows(
          `SELECT count(*)::int AS count FROM user_roles WHERE user_id = '${PROBE_USERS.grantedManager}'`,
        ),
      ).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'a grantor CAN assign a role whose effective set it holds — the user_roles positive case',
    async () => {
      const attempt = await attemptWrite(
        GRANTEE,
        memberClaims,
        `INSERT INTO user_roles (user_id, role_id) VALUES ('${PROBE_USERS.grantedViewer}', '${ROLES.viewer}')`,
      );
      expect(attempt.ok, `expected success, got ${attempt.code}: ${attempt.message}`).toBe(true);

      expect(
        await countGrantRows(
          `SELECT count(*)::int AS count FROM user_roles WHERE user_id = '${PROBE_USERS.grantedViewer}' AND role_id = '${ROLES.viewer}'`,
        ),
      ).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'an UPDATE that repoints a grant to a permission the actor lacks is refused — BEFORE UPDATE is the same escalation',
    async () => {
      // The probe needs a writer that is not app_admin and can UPDATE with a
      // WHERE clause (which requires SELECT — withheld from app_member on
      // purpose), so it runs as the table owner with the member's claims in the
      // GUC: also the F1 shape, since the actor arrives caller-writable.
      const owner = ownerClient();
      await owner.connect();
      let code: string | undefined;
      let message: string | undefined;
      try {
        await owner.query('BEGIN');
        await owner.query(`SELECT set_config('request.jwt.claims', $1, true)`, [memberClaims]);
        try {
          await owner.query(
            `UPDATE role_permissions SET permission_id = '${projectDelete}' WHERE role_id = '${ROLES.viewer}' AND permission_id = '${projectRead}'`,
          );
        } catch (error) {
          const pgError = error as { code?: unknown; message?: unknown };
          code = typeof pgError.code === 'string' ? pgError.code : undefined;
          message = typeof pgError.message === 'string' ? pgError.message : undefined;
        }
        await owner.query('ROLLBACK');
      } finally {
        await owner.end();
      }

      expect(code).toBe('42501');
      expect(message).toContain('grant-subset');

      expect(
        await countGrantRows(
          `SELECT count(*)::int AS count FROM role_permissions WHERE role_id = '${ROLES.viewer}' AND permission_id = '${projectRead}'`,
        ),
      ).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'a write carrying no caller identity and not the superset principal is refused — fail closed',
    async () => {
      // No claims at all: actor() is NULL, the role is app_member, and the only
      // identity-free pass is the superset principal's provisioning branch.
      const attempt = await attemptWrite(
        GRANTEE,
        undefined,
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ('${ROLES.contributor}', '${projectRead}')`,
      );

      expect(attempt.ok).toBe(false);
      expect(attempt.code).toBe('42501');
      expect(attempt.message).toContain('carries no caller identity');
    },
    TIMEOUT,
  );

  it(
    'app_admin is the superset principal: it confers anything — asserted on both paths, not exempted implicitly',
    async () => {
      // The PROVISIONING path: through the boundary as app_admin with no claims
      // in scope. This is how the seed writes, and it is the branch that must
      // exist for provisioning to work at all.
      const provisioned = await attemptWrite(
        'app_admin',
        undefined,
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ('${ROLES.viewer}', '${projectDelete}')`,
      );
      expect(provisioned.ok, `expected success, got ${provisioned.code}: ${provisioned.message}`).toBe(true);

      // Removed immediately: viewer must not keep project.delete, or every
      // later denial probe that relies on the member's viewer set goes green
      // for the wrong reason.
      const cleaned = attemptAsSuperuser([
        `DELETE FROM role_permissions WHERE role_id = '${ROLES.viewer}' AND permission_id = '${projectDelete}'`,
      ]);
      expect(cleaned.ok, cleaned.output).toBe(true);

      // The REQUEST path: an app_admin request carrying the administrator's
      // sub. This does NOT take the provisioning branch — the actor is known —
      // so it proves the subset check itself passes for the superset role
      // rather than app_admin being waved through.
      const requested = await attemptWrite(
        'app_admin',
        claimsFor(USERS.administrator, 'app_admin'),
        `INSERT INTO user_roles (user_id, role_id) VALUES ('${PROBE_USERS.grantedAdministrator}', '${ROLES.administrator}')`,
      );
      expect(requested.ok, `expected success, got ${requested.code}: ${requested.message}`).toBe(true);

      expect(
        await countGrantRows(
          `SELECT count(*)::int AS count FROM user_roles WHERE user_id = '${PROBE_USERS.grantedAdministrator}' AND role_id = '${ROLES.administrator}'`,
        ),
      ).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'a superuser session writes out of band — the operator path, same exception as the administrative floor',
    () => {
      const written = attemptAsSuperuser([
        `INSERT INTO user_roles (user_id, role_id) VALUES ('99999999-0000-0000-0000-000000000004', '${ROLES.manager}')`,
      ]);
      expect(written.ok, `expected success, got: ${written.output}`).toBe(true);

      const removed = attemptAsSuperuser([`DELETE FROM user_roles WHERE user_id = '99999999-0000-0000-0000-000000000004'`]);
      expect(removed.ok, removed.output).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'removing the trigger makes the first attack SUCCEED — the test can fail (tamper, then restore)',
    async () => {
      // The proof this suite is not vacuous: with the control removed, case 1's
      // exact write goes through.
      const dropped = attemptAsSuperuser(['DROP TRIGGER role_permissions_grant_subset ON role_permissions']);
      expect(dropped.ok, dropped.output).toBe(true);

      const widened = await attemptWrite(
        GRANTEE,
        memberClaims,
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ('${ROLES.contributor}', '${projectDelete}')`,
      );
      expect(widened.ok, 'with the trigger dropped, the attack must succeed — otherwise the test never tested it').toBe(true);
      expect(
        await countGrantRows(
          `SELECT count(*)::int AS count FROM role_permissions WHERE role_id = '${ROLES.contributor}' AND permission_id = '${projectDelete}'`,
        ),
      ).toBe(1);

      // Restore the control exactly as the migration creates it, remove the row
      // the tamper let through, and re-run the attack: red, then green.
      const recreated = attemptAsSuperuser([
        `CREATE TRIGGER role_permissions_grant_subset
           BEFORE INSERT OR UPDATE ON role_permissions
           FOR EACH ROW EXECUTE FUNCTION assert_grant_subset()`,
        `DELETE FROM role_permissions WHERE role_id = '${ROLES.contributor}' AND permission_id = '${projectDelete}'`,
      ]);
      expect(recreated.ok, recreated.output).toBe(true);

      const restored = await attemptWrite(
        GRANTEE,
        memberClaims,
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ('${ROLES.contributor}', '${projectDelete}')`,
      );
      expect(restored.ok).toBe(false);
      expect(restored.code).toBe('42501');
      expect(restored.message).toContain('grant-subset');
    },
    TIMEOUT,
  );

  it(
    'no serving role holds TRUNCATE on the grant tables — the row-trigger gap stays closed by grants',
    async () => {
      // TRUNCATE does not fire a row trigger, so the only thing between a
      // serving role and a wholesale rewrite of the grant tables is the absent
      // grant. Asserted per role rather than left in the migration comment.
      const owner = ownerClient();
      await owner.connect();
      try {
        const result = await owner.query<{ table: string; role: string; truncatable: boolean }>(
          `SELECT t.tablename AS table, r.rolname AS role,
                  has_table_privilege(r.rolname, t.tablename, 'TRUNCATE') AS truncatable
             FROM pg_tables t CROSS JOIN (VALUES ('app_admin'), ('app_member')) AS r(rolname)
            WHERE t.schemaname = 'public' AND t.tablename IN ('role_permissions', 'user_roles')
            ORDER BY t.tablename, r.rolname`,
        );
        expect(result.rows).toHaveLength(4);
        for (const row of result.rows) {
          expect(row.truncatable, `${row.role} holds TRUNCATE on ${row.table}`).toBe(false);
        }
      } finally {
        await owner.end();
      }
    },
    TIMEOUT,
  );
});
