import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedPermissionsData1690000000001 implements MigrationInterface {
  name = 'SeedPermissionsData1690000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // This migration is deprecated.
    // Its seeding logic for permissions, roles, and role_permissions used PostgreSQL-specific syntax (UUIDs)
    // and targeted table names that were inconsistent with the standardized plural names.
    // The corrected and SQLite-compatible seeding logic for these entities has been merged into
    // the revised 1658012445678-SeedInitialPermissions.ts migration.
    // Making this a no-op to preserve migration history.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This migration is deprecated. Corresponding down operations are handled elsewhere or not needed.
  }
}
