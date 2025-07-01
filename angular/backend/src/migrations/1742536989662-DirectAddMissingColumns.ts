import { MigrationInterface, QueryRunner } from 'typeorm';

export class DirectAddMissingColumns1742536989662
  implements MigrationInterface
{
  name = 'DirectAddMissingColumns1742536989662';

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('Starting direct column addition migration...');

    // First check for permissions table
    const permissionsTableExists = await queryRunner.hasTable('permissions');
    if (!permissionsTableExists) {
      // If permissions doesn't exist, check for permission table
      const permissionTableExists = await queryRunner.hasTable('permission');
      if (permissionTableExists) {
        console.log('Creating permissions table from permission table');

        // Create new table with proper name
        await queryRunner.query(`
                    CREATE TABLE IF NOT EXISTS "permissions" (
                        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                        "name" VARCHAR(100) UNIQUE,
                        "description" TEXT,
                        "resource_name" VARCHAR(50),
                        "action" VARCHAR(50),
                        "action_id" INTEGER,
                        "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
                        "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

        // Copy data
        await queryRunner.query(`
                    INSERT INTO "permissions" ("id", "name", "description", "action_id", "created_at", "updated_at")
                    SELECT "id", "name", "description", "action_id", "created_at", "updated_at" 
                    FROM "permission"
                `);

        // Extract resource_name and action from name field
        await queryRunner.query(`
                    UPDATE "permissions"
                    SET 
                        "resource_name" = SUBSTR("name", 1, INSTR("name", ':') - 1),
                        "action" = SUBSTR("name", INSTR("name", ':') + 1)
                    WHERE INSTR("name", ':') > 0
                `);

        console.log(
          'Permissions table created and data copied from permission table',
        );
      } else {
        console.log(
          'Neither permissions nor permission table exists, creating new permissions table',
        );

        // Create new table
        await queryRunner.query(`
                    CREATE TABLE "permissions" (
                        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                        "name" VARCHAR(100) UNIQUE,
                        "description" TEXT,
                        "resource_name" VARCHAR(50),
                        "action" VARCHAR(50),
                        "action_id" INTEGER,
                        "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
                        "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

        console.log('Empty permissions table created');
      }
    } else {
      console.log(
        'Permissions table already exists, checking for missing columns',
      );

      // Get current columns
      const columns = await queryRunner.query('PRAGMA table_info(permissions)');
      const columnNames = columns.map((col: any) => col.name);
      console.log(`Current columns: ${columnNames.join(', ')}`);

      // Add resource_name column if missing
      if (!columnNames.includes('resource_name')) {
        console.log('Adding resource_name column');
        await queryRunner.query(
          `ALTER TABLE "permissions" ADD COLUMN "resource_name" VARCHAR(50)`,
        );
      }

      // Add action column if missing
      if (!columnNames.includes('action')) {
        console.log('Adding action column');
        await queryRunner.query(
          `ALTER TABLE "permissions" ADD COLUMN "action" VARCHAR(50)`,
        );
      }

      // Update resource_name and action from name field if they're empty
      await queryRunner.query(`
                UPDATE "permissions"
                SET 
                    "resource_name" = SUBSTR("name", 1, INSTR("name", ':') - 1)
                WHERE 
                    "resource_name" IS NULL AND INSTR("name", ':') > 0
            `);

      await queryRunner.query(`
                UPDATE "permissions"
                SET 
                    "action" = SUBSTR("name", INSTR("name", ':') + 1)
                WHERE 
                    "action" IS NULL AND INSTR("name", ':') > 0
            `);
    }

    // Create indexes
    console.log('Creating indexes');
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_permissions_name" ON "permissions" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_permissions_resource_name" ON "permissions" ("resource_name")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_permissions_action" ON "permissions" ("action")`,
    );

    // Fix references to permission table if it exists
    if (await queryRunner.hasTable('permission')) {
      console.log('Checking for tables referencing the permission table');

      // Check if user_permission table exists and fix references
      if (await queryRunner.hasTable('user_permission')) {
        console.log('Fixing user_permission foreign keys');
        await queryRunner.query(`
                    PRAGMA foreign_keys = OFF;
                    
                    CREATE TABLE "user_permission_fixed" (
                        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                        "user_id" INTEGER NOT NULL,
                        "permission_id" INTEGER NOT NULL,
                        "granted" BOOLEAN DEFAULT 1,
                        "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
                        "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
                        FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE,
                        UNIQUE ("user_id", "permission_id")
                    );
                    
                    INSERT INTO "user_permission_fixed" SELECT * FROM "user_permission";
                    DROP TABLE "user_permission";
                    ALTER TABLE "user_permission_fixed" RENAME TO "user_permission";
                    
                    CREATE INDEX IF NOT EXISTS "idx_user_permission_user_id" ON "user_permission" ("user_id");
                    CREATE INDEX IF NOT EXISTS "idx_user_permission_permission_id" ON "user_permission" ("permission_id");
                    
                    PRAGMA foreign_keys = ON;
                `);
      }

      // Check if role_permissions table exists and fix references
      if (await queryRunner.hasTable('role_permissions')) {
        console.log('Fixing role_permissions foreign keys');
        await queryRunner.query(`
                    PRAGMA foreign_keys = OFF;
                    
                    CREATE TABLE "role_permissions_fixed" (
                        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                        "role_id" INTEGER NOT NULL,
                        "permission_id" INTEGER NOT NULL,
                        "granted" BOOLEAN DEFAULT 1,
                        "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
                        "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE CASCADE,
                        FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE,
                        UNIQUE ("role_id", "permission_id")
                    );
                    
                    INSERT INTO "role_permissions_fixed" SELECT * FROM "role_permissions";
                    DROP TABLE "role_permissions";
                    ALTER TABLE "role_permissions_fixed" RENAME TO "role_permissions";
                    
                    CREATE INDEX IF NOT EXISTS "idx_role_permissions_role_id" ON "role_permissions" ("role_id");
                    CREATE INDEX IF NOT EXISTS "idx_role_permissions_permission_id" ON "role_permissions" ("permission_id");
                    
                    PRAGMA foreign_keys = ON;
                `);
      }
    }

    console.log('Migration completed successfully');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Dropping columns is not supported in SQLite, so we only drop indexes
    console.log('Rolling back indexes only');

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_permissions_resource_name"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_permissions_action"`);
  }
}
