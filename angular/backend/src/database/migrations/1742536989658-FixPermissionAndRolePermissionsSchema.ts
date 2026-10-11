import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixPermissionAndRolePermissionsSchema1742536989658 implements MigrationInterface {
  name = 'FixPermissionAndRolePermissionsSchema1742536989658';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Skipping problematic migration
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
