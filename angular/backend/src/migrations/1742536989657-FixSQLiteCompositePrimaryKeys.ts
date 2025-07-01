import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * This migration addresses SQLite compatibility issues with composite primary keys
 * by adding a single primary key column (id) to join tables that previously used composite primary keys
 */
export class FixSQLiteCompositePrimaryKeys1742536989657
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fix component_permissions table
    const hasComponentPermissionsTable = await queryRunner.hasTable(
      'component_permissions',
    );
    if (hasComponentPermissionsTable) {
      // Check if it already has an id column
      const hasIdColumn = await this.hasColumn(
        queryRunner,
        'component_permissions',
        'id',
      );
      if (!hasIdColumn) {
        // Create temporary table with id
        await queryRunner.query(`
          CREATE TABLE "component_permissions_temp" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "component_id" integer NOT NULL,
            "permission_id" integer NOT NULL,
            UNIQUE ("component_id", "permission_id")
          )
        `);

        // Copy data
        await queryRunner.query(`
          INSERT INTO "component_permissions_temp" ("component_id", "permission_id")
          SELECT "component_id", "permission_id" FROM "component_permissions"
        `);

        // Drop original table
        await queryRunner.query(`DROP TABLE "component_permissions"`);

        // Rename temp table to original
        await queryRunner.query(
          `ALTER TABLE "component_permissions_temp" RENAME TO "component_permissions"`,
        );

        // Re-add foreign key constraints
        await queryRunner.query(`
          CREATE INDEX "IDX_component_id" ON "component_permissions" ("component_id")
        `);
        await queryRunner.query(`
          CREATE INDEX "IDX_permission_id" ON "component_permissions" ("permission_id")
        `);
      }
    }

    // Fix api_endpoint_permissions table
    const hasApiEndpointPermissionsTable = await queryRunner.hasTable(
      'api_endpoint_permissions',
    );
    if (hasApiEndpointPermissionsTable) {
      const hasIdColumn = await this.hasColumn(
        queryRunner,
        'api_endpoint_permissions',
        'id',
      );
      if (!hasIdColumn) {
        // Create temporary table with id
        await queryRunner.query(`
          CREATE TABLE "api_endpoint_permissions_temp" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "endpoint_id" integer NOT NULL,
            "permission_id" integer NOT NULL,
            UNIQUE ("endpoint_id", "permission_id")
          )
        `);

        // Copy data
        await queryRunner.query(`
          INSERT INTO "api_endpoint_permissions_temp" ("endpoint_id", "permission_id")
          SELECT "endpoint_id", "permission_id" FROM "api_endpoint_permissions"
        `);

        // Drop original table
        await queryRunner.query(`DROP TABLE "api_endpoint_permissions"`);

        // Rename temp table to original
        await queryRunner.query(
          `ALTER TABLE "api_endpoint_permissions_temp" RENAME TO "api_endpoint_permissions"`,
        );

        // Re-add indexes
        await queryRunner.query(`
          CREATE INDEX "IDX_endpoint_id" ON "api_endpoint_permissions" ("endpoint_id")
        `);
        await queryRunner.query(`
          CREATE INDEX "IDX_api_permission_id" ON "api_endpoint_permissions" ("permission_id")
        `);
      }
    }

    // Fix frontend_route_permissions table
    const hasFrontendRoutePermissionsTable = await queryRunner.hasTable(
      'frontend_route_permissions',
    );
    if (hasFrontendRoutePermissionsTable) {
      const hasIdColumn = await this.hasColumn(
        queryRunner,
        'frontend_route_permissions',
        'id',
      );
      if (!hasIdColumn) {
        // Create temporary table with id
        await queryRunner.query(`
          CREATE TABLE "frontend_route_permissions_temp" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "route_id" integer NOT NULL,
            "permission_id" integer NOT NULL,
            UNIQUE ("route_id", "permission_id")
          )
        `);

        // Copy data
        await queryRunner.query(`
          INSERT INTO "frontend_route_permissions_temp" ("route_id", "permission_id")
          SELECT "route_id", "permission_id" FROM "frontend_route_permissions"
        `);

        // Drop original table
        await queryRunner.query(`DROP TABLE "frontend_route_permissions"`);

        // Rename temp table to original
        await queryRunner.query(
          `ALTER TABLE "frontend_route_permissions_temp" RENAME TO "frontend_route_permissions"`,
        );

        // Re-add indexes
        await queryRunner.query(`
          CREATE INDEX "IDX_route_id" ON "frontend_route_permissions" ("route_id")
        `);
        await queryRunner.query(`
          CREATE INDEX "IDX_route_permission_id" ON "frontend_route_permissions" ("permission_id")
        `);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This is a complex operation to revert back to composite primary keys
    // We're not implementing it as it would be risky and typically not needed
    console.log('Downgrade not implemented for this migration');
  }

  private async hasColumn(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ): Promise<boolean> {
    const query = `PRAGMA table_info(${table})`;
    const columns = await queryRunner.query(query);
    return columns.some((col) => col.name === column);
  }
}
