import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddIsGrantedToRolePermissions1704067200001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add is_granted column to role_permissions for 3-state permissions
    // null = inherit from parent role, true = granted, false = denied
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('role_permissions', 'is_granted');
  }
}
