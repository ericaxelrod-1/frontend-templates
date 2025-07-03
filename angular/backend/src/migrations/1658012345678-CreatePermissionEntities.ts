import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePermissionEntities1658012345678
  implements MigrationInterface
{
  name = 'CreatePermissionEntities1658012345678';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create actions table first (referenced by permissions)
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "actions" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "name" VARCHAR(255) NOT NULL UNIQUE,
                "description" VARCHAR(255),
                "action_code" VARCHAR(255) NOT NULL UNIQUE,
                "icon" VARCHAR(255),
                "category" VARCHAR(100),
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now'))
            )
        `);

    // Create permissions table
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "permissions" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "name" VARCHAR(100) NOT NULL UNIQUE,
                "description" VARCHAR(255),
                "resource_name" VARCHAR(50) NOT NULL,
                "action_id" INTEGER NOT NULL,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY ("action_id") REFERENCES "actions"("id") ON DELETE CASCADE,
                UNIQUE("resource_name", "action_id")
            )
        `);

    // Create roles table
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "roles" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "name" VARCHAR(100) NOT NULL UNIQUE,
                "description" VARCHAR(255),
                "is_system_role" BOOLEAN NOT NULL DEFAULT 0,
                "is_default" BOOLEAN NOT NULL DEFAULT 0,
                "parent_id" INTEGER,
                "priority" INTEGER,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY ("parent_id") REFERENCES "roles"("id") ON DELETE SET NULL
            )
        `);

    // Create groups table
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "groups" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "name" VARCHAR(50) NOT NULL UNIQUE,
                "description" VARCHAR(255),
                "settings" TEXT,
                "is_system_group" BOOLEAN NOT NULL DEFAULT 0,
                "owner_id" INTEGER,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL
            )
        `);

    // Create UI components table with VARCHAR primary key
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "ui_components" (
                "id" VARCHAR(255) PRIMARY KEY,
                "description" TEXT,
                "file_path" VARCHAR(255),
                "override_permissions" BOOLEAN NOT NULL DEFAULT 0,
                "last_synced_at" DATETIME,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now'))
            )
        `);

    // Create frontend routes table with VARCHAR primary key
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "frontend_routes" (
                "id" VARCHAR(255) PRIMARY KEY,
                "title" VARCHAR(255),
                "description" TEXT,
                "component_name" VARCHAR(255),
                "override_permissions" BOOLEAN NOT NULL DEFAULT 0,
                "last_synced_at" DATETIME,
                "is_disabled" BOOLEAN NOT NULL DEFAULT 0,
                "show_in_menu" BOOLEAN NOT NULL DEFAULT 1,
                "icon" VARCHAR(255),
                "menu_order" INTEGER NOT NULL DEFAULT 100,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now'))
            )
        `);

    // Create API endpoints table with VARCHAR primary key
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "api_endpoints" (
                "id" VARCHAR(255) PRIMARY KEY,
                "method" VARCHAR(20) NOT NULL,
                "path" VARCHAR(255) NOT NULL,
                "description" TEXT,
                "controller_name" VARCHAR(100),
                "handler_name" VARCHAR(100),
                "override_permissions" BOOLEAN NOT NULL DEFAULT 0,
                "last_synced_at" DATETIME,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now'))
            )
        `);

    // Create resources table
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "resources" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "name" VARCHAR(100) NOT NULL UNIQUE,
                "description" TEXT,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now'))
            )
        `);

    // Create relationship tables with correct foreign key column names
    // Role-Permission
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "role_permissions" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "role_id" INTEGER NOT NULL,
                "permission_id" INTEGER NOT NULL,
                "is_granted" BOOLEAN NOT NULL DEFAULT 1,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE,
                FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE,
                UNIQUE("role_id", "permission_id")
            )
        `);

    // Group-Permission
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "group_permissions" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "group_id" INTEGER NOT NULL,
                "permission_id" INTEGER NOT NULL,
                "is_granted" BOOLEAN NOT NULL DEFAULT 1,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE,
                FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE,
                UNIQUE("group_id", "permission_id")
            )
        `);

    // User-Permission
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "user_permissions" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "user_id" INTEGER NOT NULL,
                "permission_id" INTEGER NOT NULL,
                "is_granted" BOOLEAN NOT NULL DEFAULT 1,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
                FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE,
                UNIQUE("user_id", "permission_id")
            )
        `);

    // UI Component-Permission with correct foreign key column name
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "ui_component_permissions" (
                "ui_component_id" VARCHAR(255) NOT NULL,
                "permission_id" INTEGER NOT NULL,
                PRIMARY KEY ("ui_component_id", "permission_id"),
                FOREIGN KEY ("ui_component_id") REFERENCES "ui_components"("id") ON DELETE CASCADE,
                FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
            )
        `);

    // Frontend Route-Permission with correct foreign key column name
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "frontend_route_permissions" (
                "frontend_route_id" VARCHAR(255) NOT NULL,
                "permission_id" INTEGER NOT NULL,
                PRIMARY KEY ("frontend_route_id", "permission_id"),
                FOREIGN KEY ("frontend_route_id") REFERENCES "frontend_routes"("id") ON DELETE CASCADE,
                FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
            )
        `);

    // API Endpoint-Permission with correct foreign key column name
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "api_endpoint_permissions" (
                "api_endpoint_id" VARCHAR(255) NOT NULL,
                "permission_id" INTEGER NOT NULL,
                PRIMARY KEY ("api_endpoint_id", "permission_id"),
                FOREIGN KEY ("api_endpoint_id") REFERENCES "api_endpoints"("id") ON DELETE CASCADE,
                FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
            )
        `);

    // User-Role
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "user_roles" (
                "user_id" INTEGER NOT NULL,
                "role_id" INTEGER NOT NULL,
                FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
                FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
                PRIMARY KEY ("user_id", "role_id")
            )
        `);

    // User-Group
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "user_groups" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "user_id" INTEGER NOT NULL,
                "group_id" INTEGER NOT NULL,
                "is_admin" BOOLEAN NOT NULL DEFAULT 0,
                "group_permissions_override" TEXT,
                "joined_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "last_active_at" DATETIME,
                FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
                FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE
            )
        `);

    // Seed default actions
    await queryRunner.query(`
            INSERT OR IGNORE INTO "actions" (name, description, action_code, category) VALUES
            ('create', 'Create new resources', 'CREATE', 'CRUD'),
            ('read', 'View/read resources', 'READ', 'CRUD'),
            ('update', 'Modify existing resources', 'UPDATE', 'CRUD'),
            ('delete', 'Remove resources', 'DELETE', 'CRUD'),
            ('manage', 'Full management access', 'MANAGE', 'ADMIN'),
            ('view', 'View access', 'VIEW', 'BASIC'),
            ('edit', 'Edit access', 'EDIT', 'BASIC')
        `);

    // Seed default groups
    await queryRunner.query(`
            INSERT OR IGNORE INTO "groups" (name, description, is_system_group) VALUES
            ('General', 'General users group', 0),
            ('Managers', 'Managers group with elevated access', 0),
            ('Superusers', 'Superusers with extended system access', 1)
        `);

    // Seed default roles
    await queryRunner.query(`
            INSERT OR IGNORE INTO "roles" (name, description, is_system_role, is_default) VALUES
            ('Administrator', 'Full system access', 1, 0),
            ('User', 'Standard user access', 1, 1),
            ('Guest', 'Limited guest access', 1, 0),
            ('Super User', 'Extended user privileges', 1, 0),
            ('Super Administrator', 'Ultimate system access', 1, 0)
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop relationship tables first
    await queryRunner.query(`DROP TABLE IF EXISTS "user_groups"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "api_endpoint_permissions"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "frontend_route_permissions"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ui_component_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "group_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "role_permissions"`);

    // Drop main tables
    await queryRunner.query(`DROP TABLE IF EXISTS "api_endpoints"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "frontend_routes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ui_components"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "resources"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "groups"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "actions"`);
  }
}
