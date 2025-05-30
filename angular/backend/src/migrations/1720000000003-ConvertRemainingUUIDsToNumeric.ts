import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertRemainingUUIDsToNumeric1720000000003
  implements MigrationInterface
{
  name = 'ConvertRemainingUUIDsToNumeric1720000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create backup tables
    await queryRunner.query(
      `CREATE TABLE "api_endpoints_backup" AS SELECT * FROM "api_endpoints"`,
    );
    await queryRunner.query(
      `CREATE TABLE "frontend_routes_backup" AS SELECT * FROM "frontend_routes"`,
    );
    await queryRunner.query(
      `CREATE TABLE "ui_components_backup" AS SELECT * FROM "ui_components"`,
    );
    await queryRunner.query(
      `CREATE TABLE "routes_backup" AS SELECT * FROM "routes"`,
    );
    await queryRunner.query(
      `CREATE TABLE "components_backup" AS SELECT * FROM "components"`,
    );

    // Drop foreign key constraints
    await queryRunner.query(
      `ALTER TABLE "api_endpoint_permissions" DROP CONSTRAINT IF EXISTS "FK_api_endpoint_permissions_api_endpoints"`,
    );
    await queryRunner.query(
      `ALTER TABLE "frontend_route_permissions" DROP CONSTRAINT IF EXISTS "FK_frontend_route_permissions_frontend_routes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ui_component_permissions" DROP CONSTRAINT IF EXISTS "FK_ui_component_permissions_ui_components"`,
    );
    await queryRunner.query(
      `ALTER TABLE "route_permissions" DROP CONSTRAINT IF EXISTS "FK_route_permissions_routes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "component_permissions" DROP CONSTRAINT IF EXISTS "FK_component_permissions_components"`,
    );

    // Convert API Endpoints
    await queryRunner.query(
      `ALTER TABLE "api_endpoints" DROP CONSTRAINT "PK_api_endpoints"`,
    );
    await queryRunner.query(`ALTER TABLE "api_endpoints" DROP COLUMN "id"`);
    await queryRunner.query(
      `ALTER TABLE "api_endpoints" ADD "id" SERIAL PRIMARY KEY`,
    );

    // Create mapping table for API Endpoints
    await queryRunner.query(`
            CREATE TABLE "api_endpoint_id_mapping" (
                "old_id" uuid NOT NULL,
                "new_id" integer NOT NULL,
                PRIMARY KEY ("old_id")
            )
        `);

    // Insert data into API Endpoints mapping table
    await queryRunner.query(`
            INSERT INTO "api_endpoint_id_mapping" ("old_id", "new_id")
            SELECT "id"::uuid, ROW_NUMBER() OVER (ORDER BY "createdAt") 
            FROM "api_endpoints_backup"
        `);

    // Convert Frontend Routes
    await queryRunner.query(
      `ALTER TABLE "frontend_routes" DROP CONSTRAINT "PK_frontend_routes"`,
    );
    await queryRunner.query(`ALTER TABLE "frontend_routes" DROP COLUMN "id"`);
    await queryRunner.query(
      `ALTER TABLE "frontend_routes" ADD "id" SERIAL PRIMARY KEY`,
    );

    // Create mapping table for Frontend Routes
    await queryRunner.query(`
            CREATE TABLE "frontend_route_id_mapping" (
                "old_id" uuid NOT NULL,
                "new_id" integer NOT NULL,
                PRIMARY KEY ("old_id")
            )
        `);

    // Insert data into Frontend Routes mapping table
    await queryRunner.query(`
            INSERT INTO "frontend_route_id_mapping" ("old_id", "new_id")
            SELECT "id"::uuid, ROW_NUMBER() OVER (ORDER BY "createdAt") 
            FROM "frontend_routes_backup"
        `);

    // Convert UI Components
    await queryRunner.query(
      `ALTER TABLE "ui_components" DROP CONSTRAINT "PK_ui_components"`,
    );
    await queryRunner.query(`ALTER TABLE "ui_components" DROP COLUMN "id"`);
    await queryRunner.query(
      `ALTER TABLE "ui_components" ADD "id" SERIAL PRIMARY KEY`,
    );

    // Create mapping table for UI Components
    await queryRunner.query(`
            CREATE TABLE "ui_component_id_mapping" (
                "old_id" uuid NOT NULL,
                "new_id" integer NOT NULL,
                PRIMARY KEY ("old_id")
            )
        `);

    // Insert data into UI Components mapping table
    await queryRunner.query(`
            INSERT INTO "ui_component_id_mapping" ("old_id", "new_id")
            SELECT "id"::uuid, ROW_NUMBER() OVER (ORDER BY "createdAt") 
            FROM "ui_components_backup"
        `);

    // Update foreign keys in junction tables
    await queryRunner.query(`
            UPDATE "api_endpoint_permissions" aep
            SET "endpoint_id" = (
                SELECT "new_id" 
                FROM "api_endpoint_id_mapping" 
                WHERE "old_id" = aep."endpoint_id"::uuid
            )
        `);

    await queryRunner.query(`
            UPDATE "frontend_route_permissions" frp
            SET "route_id" = (
                SELECT "new_id" 
                FROM "frontend_route_id_mapping" 
                WHERE "old_id" = frp."route_id"::uuid
            )
        `);

    await queryRunner.query(`
            UPDATE "ui_component_permissions" ucp
            SET "component_id" = (
                SELECT "new_id" 
                FROM "ui_component_id_mapping" 
                WHERE "old_id" = ucp."component_id"::uuid
            )
        `);

    // Update GroupPermission and UserPermission tables to use numeric IDs
    await queryRunner.query(`
            ALTER TABLE "group_permissions" 
            ALTER COLUMN "permissionId" TYPE integer 
            USING "permissionId"::integer
        `);

    await queryRunner.query(`
            ALTER TABLE "user_permissions" 
            ALTER COLUMN "permissionId" TYPE integer 
            USING "permissionId"::integer
        `);

    // Recreate foreign key constraints
    await queryRunner.query(`
            ALTER TABLE "api_endpoint_permissions"
            ADD CONSTRAINT "FK_api_endpoint_permissions_api_endpoints"
            FOREIGN KEY ("endpoint_id")
            REFERENCES "api_endpoints"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "frontend_route_permissions"
            ADD CONSTRAINT "FK_frontend_route_permissions_frontend_routes"
            FOREIGN KEY ("route_id")
            REFERENCES "frontend_routes"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "ui_component_permissions"
            ADD CONSTRAINT "FK_ui_component_permissions_ui_components"
            FOREIGN KEY ("component_id")
            REFERENCES "ui_components"("id")
            ON DELETE CASCADE
        `);

    // Drop mapping tables
    await queryRunner.query(`DROP TABLE "api_endpoint_id_mapping"`);
    await queryRunner.query(`DROP TABLE "frontend_route_id_mapping"`);
    await queryRunner.query(`DROP TABLE "ui_component_id_mapping"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore from backups
    await queryRunner.query(`DROP TABLE IF EXISTS "api_endpoints"`);
    await queryRunner.query(
      `ALTER TABLE "api_endpoints_backup" RENAME TO "api_endpoints"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "frontend_routes"`);
    await queryRunner.query(
      `ALTER TABLE "frontend_routes_backup" RENAME TO "frontend_routes"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "ui_components"`);
    await queryRunner.query(
      `ALTER TABLE "ui_components_backup" RENAME TO "ui_components"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "routes"`);
    await queryRunner.query(`ALTER TABLE "routes_backup" RENAME TO "routes"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "components"`);
    await queryRunner.query(
      `ALTER TABLE "components_backup" RENAME TO "components"`,
    );
  }
}
