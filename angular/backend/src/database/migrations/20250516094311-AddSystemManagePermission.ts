import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FR-014: `system:manage` is referenced by three seed sources
 * (`database/seeds/permission-seeds.service.ts`, `database/seeds/initial.seed.ts`,
 * `db/seeds/role-migration.seed.ts`) but no migration ever created the
 * `permissions` row, so on a freshly provisioned database the grant silently
 * resolved to nothing and the `POST admin/system-health/clear-temp` permission
 * could never be held by anybody.
 *
 * `system:admin` is inserted here too for the same reason: it is referenced by
 * the seed sources and by the frontend's admin-section guard, but nothing in the
 * migration chain created it either.
 *
 * ORDERING: this timestamp must stay above 20250516094310
 * (`CreateAndSeedActionsTable`), which is the migration that seeds the
 * `manage` action row this one looks up. It previously sat at 1791850000000,
 * sorting *before* that migration, so the guard below threw "the manage and
 * admin actions must exist" on a fresh provision. It must also stay below
 * 20250517000000 (`CreateCacheTables`).
 */
export class AddSystemManagePermission20250516094311
  implements MigrationInterface
{
  name = 'AddSystemManagePermission20250516094311';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const manageAction = await queryRunner.query(
      `SELECT id FROM actions WHERE action_code = 'manage'`,
    );
    const adminAction = await queryRunner.query(
      `SELECT id FROM actions WHERE action_code = 'admin'`,
    );

    if (manageAction.length === 0 || adminAction.length === 0) {
      throw new Error(
        'AddSystemManagePermission: the "manage" and "admin" actions must ' +
          'exist before the system permissions are created.',
      );
    }

    await queryRunner.query(
      `INSERT OR IGNORE INTO "permissions" (name, description, resource_name, action_id)
       VALUES
         ('system:manage', 'Perform system maintenance operations', 'system', ?),
         ('system:admin', 'Full administrative access to system settings', 'system', ?)`,
      [manageAction[0].id, adminAction[0].id],
    );

    const roles = await queryRunner.query(
      `SELECT id, name FROM roles WHERE name IN ('Administrator', 'Super Administrator')`,
    );

    if (roles.length === 0) {
      throw new Error(
        'AddSystemManagePermission: neither "Administrator" nor ' +
          '"Super Administrator" exists, so the permissions would be ungranted.',
      );
    }

    const permissions = await queryRunner.query(
      `SELECT id, name FROM permissions WHERE name IN ('system:manage', 'system:admin')`,
    );

    for (const role of roles) {
      for (const permission of permissions) {
        await queryRunner.query(
          `INSERT OR IGNORE INTO "role_permissions" (role_id, permission_id, is_granted)
           VALUES (?, ?, 1)`,
          [role.id, permission.id],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "role_permissions" WHERE permission_id IN (
         SELECT id FROM "permissions" WHERE name IN ('system:manage', 'system:admin')
       )`,
    );
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE name IN ('system:manage', 'system:admin')`,
    );
  }
}
