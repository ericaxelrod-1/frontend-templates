import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAndSeedActionsTable20250516094310
  implements MigrationInterface
{
  name = 'CreateAndSeedActionsTable20250516094310';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // CREATE TABLE DDL for "actions" has been moved to 1658012345678-CreatePermissionEntities.ts
    // This migration will now only seed the data, assuming the table exists.

    const actionsSeedData = [
      {
        name: 'View',
        action_code: 'view',
        description: 'View a resource or information',
        icon: 'visibility',
      },
      {
        name: 'Create',
        action_code: 'create',
        description: 'Create a new resource instance',
        icon: 'add',
      },
      {
        name: 'Update',
        action_code: 'update',
        description: 'Update an existing resource',
        icon: 'edit',
      },
      {
        name: 'Delete',
        action_code: 'delete',
        description: 'Delete a resource instance',
        icon: 'delete',
      },
      {
        name: 'Manage',
        action_code: 'manage',
        description: 'Full management access to a resource',
        icon: 'settings',
      },
      {
        name: 'Edit',
        action_code: 'edit',
        description:
          'Edit specific aspects of a resource (often a subset of UPDATE or MANAGE)',
        icon: 'edit_note',
      },
      {
        name: 'Refresh',
        action_code: 'refresh',
        description: 'Refresh data or cache for a resource',
        icon: 'refresh',
      },
      {
        name: 'Access',
        action_code: 'access',
        description:
          'General access to a feature or API (less specific than CRUD)',
        icon: 'lock_open',
      },
      {
        name: 'Assign',
        action_code: 'assign',
        description: 'Ability to assign roles or permissions',
        icon: 'assignment',
      },
      {
        name: 'Impersonate',
        action_code: 'impersonate',
        description: 'Ability to impersonate another user',
        icon: 'face',
      },
      {
        name: 'View Admin Section',
        action_code: 'view_admin',
        description: 'Ability to view administrative sections/data',
        icon: 'admin_panel_settings',
      },
      {
        name: 'Manage System Settings',
        action_code: 'manage_system',
        description: 'Ability to manage system-level settings',
        icon: 'tune',
      },
      {
        name: 'View Logs',
        action_code: 'view_logs',
        description: 'Ability to view system or audit logs',
        icon: 'list_alt',
      },
    ];

    for (const action of actionsSeedData) {
      await queryRunner.query(
        // Ensuring created_at and updated_at are not inserted here, as the table DDL provides defaults.
        `INSERT INTO "actions" ("name", "action_code", "description", "icon") VALUES ($1, $2, $3, $4)`,
        [action.name, action.action_code, action.description, action.icon],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Delete all seeded actions by their action_code values
    const actionCodes = [
      'view',
      'create',
      'update',
      'delete',
      'manage',
      'edit',
      'refresh',
      'access',
      'assign',
      'impersonate',
      'view_admin',
      'manage_system',
      'view_logs',
    ];
    await queryRunner.query(
      `DELETE FROM "actions" WHERE "action_code" IN (${actionCodes.map((_, i) => `$${i + 1}`).join(',')})`,
      actionCodes,
    );
  }
}
