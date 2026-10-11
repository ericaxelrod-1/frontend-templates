import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdatePermissionActionField1742536989656 implements MigrationInterface {
  name = 'UpdatePermissionActionField1742536989656';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Skipping problematic migration
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
