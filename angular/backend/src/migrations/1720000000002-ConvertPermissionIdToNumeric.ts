import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertPermissionIdToNumeric1720000000002
  implements MigrationInterface
{
  name = 'ConvertPermissionIdToNumeric1720000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create backup tables
    await queryRunner.query(
      `CREATE TABLE "permissions_backup" AS SELECT * FROM "permissions"`,
    );
    await queryRunner.query(
      `CREATE TABLE "role_permissions_backup" AS SELECT * FROM "role_permissions"`,
    );
    await queryRunner.query(
      `CREATE TABLE "group_permissions_backup" AS SELECT * FROM "group_permissions"`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_permissions_backup" AS SELECT * FROM "user_permissions"`,
    );
    await queryRunner.query(
      `CREATE TABLE "ui_component_permissions_backup" AS SELECT * FROM "ui_component_permissions"`,
    );
    await queryRunner.query(
      `CREATE TABLE "frontend_route_permissions_backup" AS SELECT * FROM "frontend_route_permissions"`,
    );
    await queryRunner.query(
      `CREATE TABLE "api_endpoint_permissions_backup" AS SELECT * FROM "api_endpoint_permissions"`,
    );

    // Drop foreign key constraints
    await queryRunner.query(
      `ALTER TABLE "role_permissions" DROP CONSTRAINT IF EXISTS "FK_role_permissions_permissions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_permissions" DROP CONSTRAINT IF EXISTS "FK_group_permissions_permissions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_permissions" DROP CONSTRAINT IF EXISTS "FK_user_permissions_permissions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ui_component_permissions" DROP CONSTRAINT IF EXISTS "FK_ui_component_permissions_permissions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "frontend_route_permissions" DROP CONSTRAINT IF EXISTS "FK_frontend_route_permissions_permissions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "api_endpoint_permissions" DROP CONSTRAINT IF EXISTS "FK_api_endpoint_permissions_permissions"`,
    );

    // Modify permissions table to use numeric IDs
    await queryRunner.query(
      `ALTER TABLE "permissions" DROP CONSTRAINT "PK_permissions"`,
    );
    await queryRunner.query(`ALTER TABLE "permissions" DROP COLUMN "id"`);
    await queryRunner.query(
      `ALTER TABLE "permissions" ADD "id" SERIAL PRIMARY KEY`,
    );

    // Create mapping table for old UUID to new numeric ID
    await queryRunner.query(`
            CREATE TABLE "permission_id_mapping" (
                "old_id" uuid NOT NULL,
                "new_id" integer NOT NULL,
                PRIMARY KEY ("old_id")
            )
        `);

    // Insert data into mapping table
    await queryRunner.query(`
            INSERT INTO "permission_id_mapping" ("old_id", "new_id")
            SELECT "id"::uuid, ROW_NUMBER() OVER (ORDER BY "createdAt") 
            FROM "permissions_backup"
        `);

    // Update foreign keys in related tables using the mapping
    await queryRunner.query(`
            UPDATE "role_permissions" rp
            SET "permissionId" = (
                SELECT "new_id" 
                FROM "permission_id_mapping" 
                WHERE "old_id" = rp."permissionId"::uuid
            )
        `);

    await queryRunner.query(`
            UPDATE "group_permissions" gp
            SET "permission_id" = (
                SELECT "new_id" 
                FROM "permission_id_mapping" 
                WHERE "old_id" = gp."permission_id"::uuid
            )
        `);

    await queryRunner.query(`
            UPDATE "user_permissions" up
            SET "permissionId" = (
                SELECT "new_id" 
                FROM "permission_id_mapping" 
                WHERE "old_id" = up."permissionId"::uuid
            )
        `);

    await queryRunner.query(`
            UPDATE "ui_component_permissions" ucp
            SET "permission_id" = (
                SELECT "new_id" 
                FROM "permission_id_mapping" 
                WHERE "old_id" = ucp."permission_id"::uuid
            )
        `);

    await queryRunner.query(`
            UPDATE "frontend_route_permissions" frp
            SET "permission_id" = (
                SELECT "new_id" 
                FROM "permission_id_mapping" 
                WHERE "old_id" = frp."permission_id"::uuid
            )
        `);

    await queryRunner.query(`
            UPDATE "api_endpoint_permissions" aep
            SET "permission_id" = (
                SELECT "new_id" 
                FROM "permission_id_mapping" 
                WHERE "old_id" = aep."permission_id"::uuid
            )
        `);

    // Recreate foreign key constraints
    await queryRunner.query(`
            ALTER TABLE "role_permissions"
            ADD CONSTRAINT "FK_role_permissions_permissions"
            FOREIGN KEY ("permissionId")
            REFERENCES "permissions"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "group_permissions"
            ADD CONSTRAINT "FK_group_permissions_permissions"
            FOREIGN KEY ("permission_id")
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

    await queryRunner.query(`
            ALTER TABLE "ui_component_permissions"
            ADD CONSTRAINT "FK_ui_component_permissions_permissions"
            FOREIGN KEY ("permission_id")
            REFERENCES "permissions"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "frontend_route_permissions"
            ADD CONSTRAINT "FK_frontend_route_permissions_permissions"
            FOREIGN KEY ("permission_id")
            REFERENCES "permissions"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "api_endpoint_permissions"
            ADD CONSTRAINT "FK_api_endpoint_permissions_permissions"
            FOREIGN KEY ("permission_id")
            REFERENCES "permissions"("id")
            ON DELETE CASCADE
        `);

    // Drop mapping table
    await queryRunner.query(`DROP TABLE "permission_id_mapping"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore from backups
    await queryRunner.query(`DROP TABLE IF EXISTS "permissions"`);
    await queryRunner.query(
      `ALTER TABLE "permissions_backup" RENAME TO "permissions"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "role_permissions"`);
    await queryRunner.query(
      `ALTER TABLE "role_permissions_backup" RENAME TO "role_permissions"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "group_permissions"`);
    await queryRunner.query(
      `ALTER TABLE "group_permissions_backup" RENAME TO "group_permissions"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "user_permissions"`);
    await queryRunner.query(
      `ALTER TABLE "user_permissions_backup" RENAME TO "user_permissions"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "ui_component_permissions"`);
    await queryRunner.query(
      `ALTER TABLE "ui_component_permissions_backup" RENAME TO "ui_component_permissions"`,
    );

    await queryRunner.query(
      `DROP TABLE IF EXISTS "frontend_route_permissions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "frontend_route_permissions_backup" RENAME TO "frontend_route_permissions"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "api_endpoint_permissions"`);
    await queryRunner.query(
      `ALTER TABLE "api_endpoint_permissions_backup" RENAME TO "api_endpoint_permissions"`,
    );
  }
}
