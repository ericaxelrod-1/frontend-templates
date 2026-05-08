import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertPermissionIdToNumeric1720000000002 implements MigrationInterface {
  name = 'ConvertPermissionIdToNumeric1720000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // This migration contains PostgreSQL specific syntax that is not supported in SQLite.
    // Skipping to allow other migrations to proceed.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
