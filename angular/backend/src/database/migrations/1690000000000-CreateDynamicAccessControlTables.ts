import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDynamicAccessControlTables1690000000000
  implements MigrationInterface
{
  name = 'CreateDynamicAccessControlTables1690000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // This migration is deprecated.
    // Its DDL for core tables (permission, ui_components, frontend_routes, api_endpoints)
    // and their related join tables used PostgreSQL-specific syntax (UUIDs) and had inconsistencies.
    // These tables are now correctly defined with SQLite-compatible DDL (INTEGER PKs/FKs, plural names)
    // in the revised 1658012345678-CreatePermissionEntities.ts migration.
    // Making this a no-op to preserve migration history.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This migration is deprecated. Corresponding down operations are handled elsewhere or not needed.
  }
}
