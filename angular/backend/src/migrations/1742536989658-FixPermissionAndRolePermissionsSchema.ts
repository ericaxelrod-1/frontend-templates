import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixPermissionAndRolePermissionsSchema1742536989658
  implements MigrationInterface
{
  name = 'FixPermissionAndRolePermissionsSchema1742536989658';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if permissions table exists
    const permissionsTableExists = await queryRunner.hasTable('permissions');

    if (!permissionsTableExists) {
      // Create permissions table from permission table if it exists
      const permissionTableExists = await queryRunner.hasTable('permission');

      if (permissionTableExists) {
        console.log('Renaming permission table to permissions');

        // Get the structure of permission table
        const columns = await queryRunner.query(
          'PRAGMA table_info(permission)',
        );
        console.log(`Permission table columns: ${JSON.stringify(columns)}`);

        // Check if temp table exists from previous migration attempt and drop it
        const tempTableExists = await queryRunner.hasTable(
          'role_permissions_temp',
        );
        if (tempTableExists) {
          console.log(
            'Dropping existing role_permissions_temp table from previous migration attempt',
          );
          await queryRunner.query('DROP TABLE role_permissions_temp');
        }

        // Create permissions table with same structure as permission
        await queryRunner.query(`
                    CREATE TABLE "permissions" AS SELECT * FROM "permission"
                `);

        // Create indexes on permissions table
        await queryRunner.query(`
                    CREATE INDEX IF NOT EXISTS "idx_permissions_name" ON "permissions" ("name")
                `);
      } else {
        console.log('Creating new permissions table');

        // Create permissions table from scratch
        await queryRunner.query(`
                    CREATE TABLE "permissions" (
                        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                        "name" VARCHAR(100) NOT NULL UNIQUE,
                        "description" VARCHAR,
                        "resource_name" VARCHAR(50),
                        "action" VARCHAR(50),
                        "action_id" INTEGER,
                        "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
                        "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

        // Create indexes
        await queryRunner.query(`
                    CREATE INDEX IF NOT EXISTS "idx_permissions_name" ON "permissions" ("name")
                `);
      }
    } else {
      console.log('Permissions table already exists');
    }

    // Fix role_permissions table to reference permissions instead of permission
    const rolePermissionsExists =
      await queryRunner.hasTable('role_permissions');

    if (rolePermissionsExists) {
      console.log('Fixing role_permissions table foreign keys');

      // Check if temp table exists from previous migration attempt and drop it
      const tempTableExists = await queryRunner.hasTable(
        'role_permissions_temp',
      );
      if (tempTableExists) {
        console.log(
          'Dropping existing role_permissions_temp table from previous migration attempt',
        );
        await queryRunner.query('DROP TABLE role_permissions_temp');
      }

      // Create a new role_permissions table with updated foreign key
      await queryRunner.query(`
                CREATE TABLE role_permissions_temp (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    role_id INTEGER NOT NULL,
                    permission_id INTEGER NOT NULL,
                    granted BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
                    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
                    UNIQUE (role_id, permission_id)
                )
            `);

      // Copy data from original table
      await queryRunner.query(`
                INSERT INTO role_permissions_temp
                SELECT * FROM role_permissions
            `);

      // Drop original table
      await queryRunner.query(`
                DROP TABLE role_permissions
            `);

      // Rename temp table to original name
      await queryRunner.query(`
                ALTER TABLE role_permissions_temp RENAME TO role_permissions
            `);

      // Recreate indexes
      await queryRunner.query(`
                CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id)
            `);

      await queryRunner.query(`
                CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id)
            `);
    } else {
      console.log('role_permissions table does not exist');
    }

    // Update foreign keys in user_permission to point to permissions table
    await queryRunner.query(`
-- Create a temporary table with the updated foreign key
CREATE TABLE user_permission_temp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  granted BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE (user_id, permission_id)
);

-- Copy data from original table
INSERT INTO user_permission_temp
SELECT * FROM user_permission;

-- Drop original table
DROP TABLE user_permission;

-- Rename temp table to original name
ALTER TABLE user_permission_temp RENAME TO user_permission;

-- Recreate indexes
CREATE INDEX idx_user_permission_user_id ON user_permission(user_id);
CREATE INDEX idx_user_permission_permission_id ON user_permission(permission_id);
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This is a schema alignment fix, so there's no clean way to roll back
    // But we'll provide an attempt to restore the original schema configuration

    // Warning: This rollback might cause issues if data has been modified
    await queryRunner.query(`
-- Revert user_permission table
CREATE TABLE user_permission_temp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  granted BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permission(id) ON DELETE CASCADE,
  UNIQUE (user_id, permission_id)
);

-- Copy data
INSERT INTO user_permission_temp
SELECT * FROM user_permission;

-- Drop modified table
DROP TABLE user_permission;

-- Rename temp table
ALTER TABLE user_permission_temp RENAME TO user_permission;

-- Recreate indexes
CREATE INDEX idx_user_permission_user_id ON user_permission(user_id);
CREATE INDEX idx_user_permission_permission_id ON user_permission(permission_id);
        `);

    // Revert role_permissions table
    await queryRunner.query(`
-- Revert role_permissions table
CREATE TABLE role_permissions_temp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  granted BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permission(id) ON DELETE CASCADE,
  UNIQUE (role_id, permission_id)
);

-- Copy data
INSERT INTO role_permissions_temp
SELECT * FROM role_permissions;

-- Drop modified table
DROP TABLE role_permissions;

-- Rename temp table
ALTER TABLE role_permissions_temp RENAME TO role_permissions;

-- Recreate indexes
CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);
        `);

    // Drop the permissions table if it was created by this migration
    if (await queryRunner.hasTable('permissions')) {
      await queryRunner.query(`DROP TABLE permissions;`);
    }
  }
}
