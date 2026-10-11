import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixLoginAttemptUserForeignKey1720000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // This migration contains PostgreSQL specific syntax that is not supported in SQLite.
    // Skipping as the schema should be consistent with entities.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
