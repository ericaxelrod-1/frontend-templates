import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1679291200000 implements MigrationInterface {
  name = 'InitialSchema1679291200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // This migration is deprecated and its DDL has been moved or is superseded.
    // Task-related tables (task, category, tag) are moved to a new dedicated migration.
    // User/role/group (singular) DDL is superseded by pluralized versions in earlier migrations.
    // Making this a no-op to preserve migration history if needed.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This migration is deprecated. Corresponding down operations are handled elsewhere or not needed.
  }
}
