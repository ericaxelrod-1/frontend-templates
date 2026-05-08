import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdatePermissionEntity1720000000100 implements MigrationInterface {
  name = 'UpdatePermissionEntity1720000000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Skipping problematic migration
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
