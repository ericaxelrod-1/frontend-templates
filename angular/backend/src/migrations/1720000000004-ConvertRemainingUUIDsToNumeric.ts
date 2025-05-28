import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertRemainingUUIDsToNumeric1720000000004
  implements MigrationInterface
{
  name = 'ConvertRemainingUUIDsToNumeric1720000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create backup tables
    await queryRunner.query(
      `CREATE TABLE "ui_components_backup" AS SELECT * FROM "ui_components"`,
    );
    await queryRunner.query(
      `CREATE TABLE "components_backup" AS SELECT * FROM "components"`,
    );
    await queryRunner.query(
      `CREATE TABLE "routes_backup" AS SELECT * FROM "routes"`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_groups_backup" AS SELECT * FROM "user_groups"`,
    );
    await queryRunner.query(
      `CREATE TABLE "group_permissions_backup" AS SELECT * FROM "group_permissions"`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_permissions_backup" AS SELECT * FROM "user_permissions"`,
    );

    // Drop foreign key constraints
    await queryRunner.query(
      `ALTER TABLE "ui_component_permissions" DROP CONSTRAINT IF EXISTS "FK_ui_component_permissions_ui_components"`,
    );
    await queryRunner.query(
      `ALTER TABLE "component_permissions" DROP CONSTRAINT IF EXISTS "FK_component_permissions_components"`,
    );
    await queryRunner.query(
      `ALTER TABLE "route_permissions" DROP CONSTRAINT IF EXISTS "FK_route_permissions_routes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_groups" DROP CONSTRAINT IF EXISTS "FK_user_groups_groups"`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_permissions" DROP CONSTRAINT IF EXISTS "FK_group_permissions_permissions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_permissions" DROP CONSTRAINT IF EXISTS "FK_user_permissions_permissions"`,
    );

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

    // Convert Components
    await queryRunner.query(
      `ALTER TABLE "components" DROP CONSTRAINT "PK_components"`,
    );
    await queryRunner.query(`ALTER TABLE "components" DROP COLUMN "id"`);
    await queryRunner.query(
      `ALTER TABLE "components" ADD "id" SERIAL PRIMARY KEY`,
    );

    // Create mapping table for Components
    await queryRunner.query(`
            CREATE TABLE "component_id_mapping" (
                "old_id" uuid NOT NULL,
                "new_id" integer NOT NULL,
                PRIMARY KEY ("old_id")
            )
        `);

    // Insert data into Components mapping table
    await queryRunner.query(`
            INSERT INTO "component_id_mapping" ("old_id", "new_id")
            SELECT "id"::uuid, ROW_NUMBER() OVER (ORDER BY "createdAt") 
            FROM "components_backup"
        `);

    // Convert Routes
    await queryRunner.query(`ALTER TABLE "routes" DROP CONSTRAINT "PK_routes"`);
    await queryRunner.query(`ALTER TABLE "routes" DROP COLUMN "id"`);
    await queryRunner.query(`ALTER TABLE "routes" ADD "id" SERIAL PRIMARY KEY`);

    // Create mapping table for Routes
    await queryRunner.query(`
            CREATE TABLE "route_id_mapping" (
                "old_id" uuid NOT NULL,
                "new_id" integer NOT NULL,
                PRIMARY KEY ("old_id")
            )
        `);

    // Insert data into Routes mapping table
    await queryRunner.query(`
            INSERT INTO "route_id_mapping" ("old_id", "new_id")
            SELECT "id"::uuid, ROW_NUMBER() OVER (ORDER BY "createdAt") 
            FROM "routes_backup"
        `);

    // Update foreign keys in junction tables
    await queryRunner.query(`
            UPDATE "ui_component_permissions" ucp
            SET "component_id" = (
                SELECT "new_id" 
                FROM "ui_component_id_mapping" 
                WHERE "old_id" = ucp."component_id"::uuid
            )
        `);

    await queryRunner.query(`
            UPDATE "component_permissions" cp
            SET "component_id" = (
                SELECT "new_id" 
                FROM "component_id_mapping" 
                WHERE "old_id" = cp."component_id"::uuid
            )
        `);

    await queryRunner.query(`
            UPDATE "route_permissions" rp
            SET "route_id" = (
                SELECT "new_id" 
                FROM "route_id_mapping" 
                WHERE "old_id" = rp."route_id"::uuid
            )
        `);

    // Update user_groups to use numeric IDs for groupId
    await queryRunner.query(
      `ALTER TABLE "user_groups" ALTER COLUMN "group_id" TYPE integer USING "group_id"::integer`,
    );

    // Update group_permissions and user_permissions to use numeric IDs for permissionId
    await queryRunner.query(
      `ALTER TABLE "group_permissions" ALTER COLUMN "permissionId" TYPE integer USING "permissionId"::integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_permissions" ALTER COLUMN "permissionId" TYPE integer USING "permissionId"::integer`,
    );

    // Recreate foreign key constraints
    await queryRunner.query(`
            ALTER TABLE "ui_component_permissions"
            ADD CONSTRAINT "FK_ui_component_permissions_ui_components"
            FOREIGN KEY ("component_id")
            REFERENCES "ui_components"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "component_permissions"
            ADD CONSTRAINT "FK_component_permissions_components"
            FOREIGN KEY ("component_id")
            REFERENCES "components"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "route_permissions"
            ADD CONSTRAINT "FK_route_permissions_routes"
            FOREIGN KEY ("route_id")
            REFERENCES "routes"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "user_groups"
            ADD CONSTRAINT "FK_user_groups_groups"
            FOREIGN KEY ("group_id")
            REFERENCES "groups"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "group_permissions"
            ADD CONSTRAINT "FK_group_permissions_permissions"
            FOREIGN KEY ("permissionId")
            REFERENCES "permissions"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "user_permissions"
            ADD CONSTRAINT "FK_user_permissions_permissions"
            FOREIGN KEY ("permissionId")
            REFERENCES "permissions"("id")
            ON DELETE CASCADE
        `);

    // Drop mapping tables
    await queryRunner.query(`DROP TABLE "ui_component_id_mapping"`);
    await queryRunner.query(`DROP TABLE "component_id_mapping"`);
    await queryRunner.query(`DROP TABLE "route_id_mapping"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore from backups
    await queryRunner.query(`DROP TABLE IF EXISTS "ui_components"`);
    await queryRunner.query(
      `ALTER TABLE "ui_components_backup" RENAME TO "ui_components"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "components"`);
    await queryRunner.query(
      `ALTER TABLE "components_backup" RENAME TO "components"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "routes"`);
    await queryRunner.query(`ALTER TABLE "routes_backup" RENAME TO "routes"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "user_groups"`);
    await queryRunner.query(
      `ALTER TABLE "user_groups_backup" RENAME TO "user_groups"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "group_permissions"`);
    await queryRunner.query(
      `ALTER TABLE "group_permissions_backup" RENAME TO "group_permissions"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "user_permissions"`);
    await queryRunner.query(
      `ALTER TABLE "user_permissions_backup" RENAME TO "user_permissions"`,
    );
  }
}
