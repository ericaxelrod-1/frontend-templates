import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrivacyAndHealthPermissions1777327198306 implements MigrationInterface {
  name = 'AddPrivacyAndHealthPermissions1777327198306';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Get action IDs
    const viewActionResult = await queryRunner.query(
      `SELECT id FROM actions WHERE action_code = 'view'`,
    );
    const readActionResult = await queryRunner.query(
      `SELECT id FROM actions WHERE action_code = 'read'`,
    );
    const editActionResult = await queryRunner.query(
      `SELECT id FROM actions WHERE action_code = 'edit'`,
    );
    const deleteActionResult = await queryRunner.query(
      `SELECT id FROM actions WHERE action_code = 'delete'`,
    );
    const adminActionResult = await queryRunner.query(
      `SELECT id FROM actions WHERE action_code = 'admin'`,
    );

    const viewActionId = viewActionResult[0]?.id || readActionResult[0]?.id;
    const readActionId = readActionResult[0]?.id || viewActionId;
    const editActionId = editActionResult[0]?.id;
    const deleteActionId = deleteActionResult[0]?.id;
    const adminActionId = adminActionResult[0]?.id;

    // Seed new permissions
    await queryRunner.query(`
      INSERT OR IGNORE INTO "permissions" (name, description, resource_name, action_id) VALUES
      ('system:health', 'View system health and resource stats', 'system', ${viewActionId}),
      ('privacy:read', 'Read privacy-related data and tickets', 'privacy', ${readActionId}),
      ('privacy:edit', 'Edit privacy-related data and tickets', 'privacy', ${editActionId}),
      ('privacy:delete', 'Delete privacy-related data and tickets', 'privacy', ${deleteActionId}),
      ('privacy:admin', 'Full administrative access to privacy systems', 'privacy', ${adminActionId})
    `);

    // Get role IDs
    const adminRoleResult = await queryRunner.query(
      `SELECT id FROM roles WHERE name = 'Administrator'`,
    );
    const superadminRoleResult = await queryRunner.query(
      `SELECT id FROM roles WHERE name = 'Super Administrator'`,
    );

    const adminRoleId = adminRoleResult[0]?.id;
    const superadminRoleId = superadminRoleResult[0]?.id;

    if (!adminRoleId && !superadminRoleId) {
      console.warn('Neither Administrator nor Super Administrator roles found.');
      return;
    }

    // Get the newly created permission IDs
    const newPermissions = await queryRunner.query(
      `SELECT id, name FROM permissions WHERE name IN ('system:health', 'privacy:read', 'privacy:edit', 'privacy:delete', 'privacy:admin')`,
    );

    // Assign to roles
    for (const perm of newPermissions) {
      if (adminRoleId) {
        await queryRunner.query(
          `INSERT OR IGNORE INTO "role_permissions" (role_id, permission_id, is_granted) VALUES (?, ?, 1)`,
          [adminRoleId, perm.id],
        );
      }
      if (superadminRoleId) {
        await queryRunner.query(
          `INSERT OR IGNORE INTO "role_permissions" (role_id, permission_id, is_granted) VALUES (?, ?, 1)`,
          [superadminRoleId, perm.id],
        );
      }
    }

    console.log('Successfully added privacy and health permissions.');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const permNames = "('system:health', 'privacy:read', 'privacy:edit', 'privacy:delete', 'privacy:admin')";
    
    // Remove role permissions first
    await queryRunner.query(`
      DELETE FROM "role_permissions" WHERE permission_id IN (
        SELECT id FROM "permissions" WHERE name IN ${permNames}
      )
    `);

    // Remove permissions
    await queryRunner.query(`DELETE FROM "permissions" WHERE name IN ${permNames}`);

    console.log('Rolled back privacy and health permissions.');
  }
}
