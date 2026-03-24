import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddIsGrantedToRolePermissions1704067200001
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add is_granted column to role_permissions for 3-state permissions
    // null = inherit from parent role, true = granted, false = denied
    const table = await queryRunner.getTable('role_permissions');
    const hasIsGranted = table.columns.some((c) => c.name === 'is_granted');

    if (!hasIsGranted) {
      await queryRunner.addColumn(
        'role_permissions',
        new TableColumn({
          name: 'is_granted',
          type: 'boolean',
          isNullable: true,
          default: null,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('role_permissions');
    const hasIsGranted = table.columns.some((c) => c.name === 'is_granted');

    if (hasIsGranted) {
      await queryRunner.dropColumn('role_permissions', 'is_granted');
    }
  }
}
