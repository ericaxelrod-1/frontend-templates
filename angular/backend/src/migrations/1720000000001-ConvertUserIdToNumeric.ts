import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertUserIdToNumeric1720000000001 implements MigrationInterface {
  name = 'ConvertUserIdToNumeric1720000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create backup tables
    await queryRunner.query(
      `CREATE TABLE "users_backup" AS SELECT * FROM "users"`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_roles_backup" AS SELECT * FROM "user_roles"`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_groups_backup" AS SELECT * FROM "user_groups"`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_permissions_backup" AS SELECT * FROM "user_permissions"`,
    );
    await queryRunner.query(
      `CREATE TABLE "tasks_backup" AS SELECT * FROM "tasks" WHERE "userId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "categories_backup" AS SELECT * FROM "categories" WHERE "userId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "tags_backup" AS SELECT * FROM "tags" WHERE "userId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_groups_backup" AS SELECT * FROM "user_groups" WHERE "userId" IS NOT NULL`,
    );

    // Drop foreign key constraints
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "FK_user_roles_users"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_groups" DROP CONSTRAINT IF EXISTS "FK_user_groups_users"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_permissions" DROP CONSTRAINT IF EXISTS "FK_user_permissions_users"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "FK_tasks_users"`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "FK_categories_users"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tags" DROP CONSTRAINT IF EXISTS "FK_tags_users"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_groups" DROP CONSTRAINT IF EXISTS "FK_user_groups_users"`,
    );

    // Modify users table to use numeric IDs
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "PK_users"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "id"`);
    await queryRunner.query(`ALTER TABLE "users" ADD "id" SERIAL PRIMARY KEY`);

    // Create mapping table for old UUID to new numeric ID
    await queryRunner.query(`
            CREATE TABLE "user_id_mapping" (
                "old_id" uuid NOT NULL,
                "new_id" integer NOT NULL,
                PRIMARY KEY ("old_id")
            )
        `);

    // Insert data into mapping table
    await queryRunner.query(`
            INSERT INTO "user_id_mapping" ("old_id", "new_id")
            SELECT "id"::uuid, ROW_NUMBER() OVER (ORDER BY "createdAt") 
            FROM "users_backup"
        `);

    // Update foreign keys in related tables using the mapping
    await queryRunner.query(`
            UPDATE "user_roles" ur
            SET "user_id" = (
                SELECT "new_id" 
                FROM "user_id_mapping" 
                WHERE "old_id" = ur."user_id"::uuid
            )
        `);

    await queryRunner.query(`
            UPDATE "user_groups" ug
            SET "user_id" = (
                SELECT "new_id" 
                FROM "user_id_mapping" 
                WHERE "old_id" = ug."user_id"::uuid
            )
        `);

    await queryRunner.query(`
            UPDATE "user_permissions" up
            SET "userId" = (
                SELECT "new_id" 
                FROM "user_id_mapping" 
                WHERE "old_id" = up."userId"::uuid
            )
        `);

    await queryRunner.query(`
            UPDATE "tasks" t
            SET "userId" = (
                SELECT "new_id" 
                FROM "user_id_mapping" 
                WHERE "old_id" = t."userId"::uuid
            )
            WHERE "userId" IS NOT NULL
        `);

    await queryRunner.query(`
            UPDATE "categories" c
            SET "userId" = (
                SELECT "new_id" 
                FROM "user_id_mapping" 
                WHERE "old_id" = c."userId"::uuid
            )
            WHERE "userId" IS NOT NULL
        `);

    await queryRunner.query(`
            UPDATE "tags" t
            SET "userId" = (
                SELECT "new_id" 
                FROM "user_id_mapping" 
                WHERE "old_id" = t."userId"::uuid
            )
            WHERE "userId" IS NOT NULL
        `);

    // Recreate foreign key constraints
    await queryRunner.query(`
            ALTER TABLE "user_roles"
            ADD CONSTRAINT "FK_user_roles_users"
            FOREIGN KEY ("user_id")
            REFERENCES "users"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "user_groups"
            ADD CONSTRAINT "FK_user_groups_users"
            FOREIGN KEY ("user_id")
            REFERENCES "users"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "user_permissions"
            ADD CONSTRAINT "FK_user_permissions_users"
            FOREIGN KEY ("userId")
            REFERENCES "users"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD CONSTRAINT "FK_tasks_users"
            FOREIGN KEY ("userId")
            REFERENCES "users"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "categories"
            ADD CONSTRAINT "FK_categories_users"
            FOREIGN KEY ("userId")
            REFERENCES "users"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "tags"
            ADD CONSTRAINT "FK_tags_users"
            FOREIGN KEY ("userId")
            REFERENCES "users"("id")
            ON DELETE CASCADE
        `);

    // Drop mapping table
    await queryRunner.query(`DROP TABLE "user_id_mapping"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore from backups
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`ALTER TABLE "users_backup" RENAME TO "users"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "user_roles"`);
    await queryRunner.query(
      `ALTER TABLE "user_roles_backup" RENAME TO "user_roles"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "user_groups"`);
    await queryRunner.query(
      `ALTER TABLE "user_groups_backup" RENAME TO "user_groups"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "user_permissions"`);
    await queryRunner.query(
      `ALTER TABLE "user_permissions_backup" RENAME TO "user_permissions"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "tasks"`);
    await queryRunner.query(`ALTER TABLE "tasks_backup" RENAME TO "tasks"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "categories"`);
    await queryRunner.query(
      `ALTER TABLE "categories_backup" RENAME TO "categories"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "tags"`);
    await queryRunner.query(`ALTER TABLE "tags_backup" RENAME TO "tags"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "user_groups"`);
    await queryRunner.query(
      `ALTER TABLE "user_groups_backup" RENAME TO "user_groups"`,
    );
  }
}
