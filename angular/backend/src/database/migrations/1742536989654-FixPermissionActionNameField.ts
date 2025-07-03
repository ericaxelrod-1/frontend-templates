import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixPermissionActionNameField1742536989654
  implements MigrationInterface
{
  name = 'FixPermissionActionNameField1742536989654';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check database type to use appropriate SQL syntax
    const dbType = queryRunner.connection.options.type;
    const isSQLite = dbType === 'sqlite' || dbType === 'better-sqlite3';

    // Check if the permission table exists
    const permissionTableExists = await queryRunner.hasTable('permissions');
    if (!permissionTableExists) {
      console.log('Permissions table does not exist, skipping migration');
      return;
    }

    // Check if action column exists
    const hasActionColumn = await queryRunner.hasColumn(
      'permissions',
      'action',
    );

    // Check if action_name column exists
    const hasActionNameColumn = await queryRunner.hasColumn(
      'permissions',
      'action_name',
    );

    if (!hasActionColumn && !hasActionNameColumn) {
      // If neither column exists, add action column
      await queryRunner.query(`
        ALTER TABLE "permissions" 
        ADD COLUMN "action" varchar(50) NOT NULL DEFAULT 'read'
      `);
      console.log('Added action column to permissions table');
    } else if (!hasActionColumn && hasActionNameColumn) {
      // If only action_name exists, rename it to action
      if (isSQLite) {
        // SQLite doesn't support direct column rename, need to create a new table
        console.log(
          'SQLite detected, creating temporary table for column rename',
        );

        // Get all column info to recreate table
        const tableColumns = await queryRunner.getTable('permissions');
        if (!tableColumns) {
          console.log(
            'Could not get permissions table structure, skipping migration',
          );
          return;
        }

        // Create temporary table with new structure
        await queryRunner.query(`
          CREATE TABLE "permissions_temp" AS 
          SELECT 
            id,
            name,
            description,
            resource_name,
            action_name as action,
            created_at,
            updated_at
          FROM "permissions"
        `);

        // Drop old table and rename new one
        await queryRunner.query(`DROP TABLE "permissions"`);
        await queryRunner.query(
          `ALTER TABLE "permissions_temp" RENAME TO "permissions"`,
        );

        // Recreate indices and constraints
        await queryRunner.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS "IDX_permissions_name" ON "permissions" ("name")
        `);
      } else {
        // PostgreSQL, MySQL, etc. support direct column rename
        await queryRunner.query(`
          ALTER TABLE "permissions" 
          RENAME COLUMN "action_name" TO "action"
        `);
      }
      console.log('Renamed action_name column to action');
    } else if (hasActionColumn && hasActionNameColumn) {
      // If both columns exist, copy data from action_name to action and drop action_name
      await queryRunner.query(`
        UPDATE "permissions" 
        SET "action" = "action_name"
        WHERE "action" IS NULL OR "action" = ''
      `);

      // Drop action_name column
      await queryRunner.query(`
        ALTER TABLE "permissions" 
        DROP COLUMN "action_name"
      `);
      console.log(
        'Copied data from action_name to action and dropped action_name column',
      );
    }

    // Add action_id column if it doesn't exist
    const hasActionIdColumn = await queryRunner.hasColumn(
      'permissions',
      'action_id',
    );
    if (!hasActionIdColumn) {
      if (isSQLite) {
        await queryRunner.query(`
          ALTER TABLE "permissions" 
          ADD COLUMN "action_id" integer NULL
        `);
      } else {
        await queryRunner.query(`
          ALTER TABLE "permissions" 
          ADD COLUMN "action_id" integer NULL REFERENCES "actions"("id") ON DELETE SET NULL
        `);
      }
      console.log('Added action_id column to permissions table');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Check database type to use appropriate SQL syntax
    const dbType = queryRunner.connection.options.type;
    const isSQLite = dbType === 'sqlite' || dbType === 'better-sqlite3';

    // Check if the permission table exists
    const permissionTableExists = await queryRunner.hasTable('permissions');
    if (!permissionTableExists) {
      console.log('Permissions table does not exist, skipping rollback');
      return;
    }

    // Check if action column exists
    const hasActionColumn = await queryRunner.hasColumn(
      'permissions',
      'action',
    );

    // Check if action_name column exists
    const hasActionNameColumn = await queryRunner.hasColumn(
      'permissions',
      'action_name',
    );

    if (hasActionColumn && !hasActionNameColumn) {
      // If only action exists, rename it back to action_name
      if (isSQLite) {
        // SQLite doesn't support direct column rename, need to create a new table
        console.log(
          'SQLite detected, creating temporary table for column rename',
        );

        // Get all column info to recreate table
        const tableColumns = await queryRunner.getTable('permissions');
        if (!tableColumns) {
          console.log(
            'Could not get permissions table structure, skipping rollback',
          );
          return;
        }

        // Create temporary table with original structure
        await queryRunner.query(`
          CREATE TABLE "permissions_temp" AS 
          SELECT 
            id,
            name,
            description,
            resource_name,
            action as action_name,
            created_at,
            updated_at,
            action_id
          FROM "permissions"
        `);

        // Drop old table and rename new one
        await queryRunner.query(`DROP TABLE "permissions"`);
        await queryRunner.query(
          `ALTER TABLE "permissions_temp" RENAME TO "permissions"`,
        );

        // Recreate indices and constraints
        await queryRunner.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS "IDX_permissions_name" ON "permissions" ("name")
        `);
      } else {
        // PostgreSQL, MySQL, etc. support direct column rename
        await queryRunner.query(`
          ALTER TABLE "permissions" 
          RENAME COLUMN "action" TO "action_name"
        `);
      }
      console.log('Renamed action column back to action_name');
    }

    // Remove action_id column if it exists
    const hasActionIdColumn = await queryRunner.hasColumn(
      'permissions',
      'action_id',
    );
    if (hasActionIdColumn) {
      await queryRunner.query(`
        ALTER TABLE "permissions" 
        DROP COLUMN "action_id"
      `);
      console.log('Removed action_id column from permissions table');
    }
  }
}
