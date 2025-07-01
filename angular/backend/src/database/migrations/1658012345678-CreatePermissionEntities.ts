import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePermissionEntities1658012345678
  implements MigrationInterface
{
  name = 'CreatePermissionEntities1658012345678';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Note: actions table is created by CreateAndSeedActionsTable20250516094310 migration

    // Create permissions table
    await queryRunner.query(`
            CREATE TABLE "permissions" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "resource_name" TEXT NOT NULL,
                "action_name" TEXT NOT NULL,
                "name" TEXT NOT NULL,
                "description" TEXT,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                UNIQUE("resource_name", "action_name")
            )
        `);

    // Create roles table
    await queryRunner.query(`
            CREATE TABLE "roles" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "name" TEXT NOT NULL UNIQUE,
                "description" TEXT,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now'))
            )
        `);

    // Create groups table
    await queryRunner.query(`
            CREATE TABLE "groups" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "name" TEXT NOT NULL UNIQUE,
                "description" TEXT,
                "owner_id" INTEGER,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE
            )
        `);

    // Create ui_components table
    await queryRunner.query(`
            CREATE TABLE "ui_components" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "selector" VARCHAR(255) UNIQUE NOT NULL,
                "description" TEXT,
                "file_path" VARCHAR(255),
                "override_permissions" BOOLEAN NOT NULL DEFAULT 0,
                "last_synced" DATETIME,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now'))
            )
        `);

    // Create frontend_routes table
    await queryRunner.query(`
            CREATE TABLE "frontend_routes" (
                "id" VARCHAR PRIMARY KEY NOT NULL,
                "path" VARCHAR NOT NULL,
                "description" VARCHAR,
                "component" VARCHAR,
                "override_permissions" BOOLEAN NOT NULL DEFAULT 0,
                "last_synced" DATETIME,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                CONSTRAINT UQ_ecb9ad00e0f804daea1dab41d49 UNIQUE (path)
            )
        `);

    // Create api_endpoints table
    await queryRunner.query(`
            CREATE TABLE "api_endpoints" (
                "id" VARCHAR PRIMARY KEY NOT NULL,
                "method" VARCHAR NOT NULL,
                "path" VARCHAR NOT NULL,
                "description" VARCHAR,
                "controller_name" VARCHAR,
                "handler_name" VARCHAR,
                "override_permissions" BOOLEAN NOT NULL DEFAULT 0,
                "last_synced" DATETIME,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now'))
            )
        `);

    // Create role_permissions table
    await queryRunner.query(`
            CREATE TABLE "role_permissions" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "role_id" INTEGER NOT NULL,
                "permission_id" INTEGER NOT NULL,
                UNIQUE("role_id", "permission_id"),
                FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE,
                FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
            )
        `);

    // Create group_permissions table
    await queryRunner.query(`
            CREATE TABLE "group_permissions" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "group_id" INTEGER NOT NULL,
                "permission_id" INTEGER NOT NULL,
                "granted" BOOLEAN NOT NULL DEFAULT 1,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
                FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
            )
        `);

    // Create ui_component_permissions table
    await queryRunner.query(`
            CREATE TABLE "ui_component_permissions" (
                "ui_component_id" INTEGER NOT NULL,
                "permission_id" INTEGER NOT NULL,
                PRIMARY KEY ("ui_component_id", "permission_id"),
                FOREIGN KEY(ui_component_id) REFERENCES ui_components(id) ON DELETE CASCADE,
                FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
            )
        `);

    // Create frontend_route_permissions table
    await queryRunner.query(`
            CREATE TABLE "frontend_route_permissions" (
                "route_id" INTEGER NOT NULL,
                "permission_id" INTEGER NOT NULL,
                PRIMARY KEY ("route_id", "permission_id"),
                FOREIGN KEY(route_id) REFERENCES frontend_routes(id) ON DELETE CASCADE,
                FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
            )
        `);

    // Create api_endpoint_permissions table
    await queryRunner.query(`
            CREATE TABLE "api_endpoint_permissions" (
                "api_endpoint_id" INTEGER NOT NULL,
                "permission_id" INTEGER NOT NULL,
                PRIMARY KEY ("api_endpoint_id", "permission_id"),
                FOREIGN KEY(api_endpoint_id) REFERENCES api_endpoints(id) ON DELETE CASCADE,
                FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
            )
        `);

    // Create user_roles table
    await queryRunner.query(`
            CREATE TABLE "user_roles" (
                "user_id" INTEGER NOT NULL,
                "role_id" INTEGER NOT NULL,
                CONSTRAINT FK_87b8888186ca9769c960e926870 FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT FK_b23c65e50a758245a33ee35fda1 FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
                PRIMARY KEY ("user_id", "role_id")
            )
        `);

    // Create user_groups table
    await queryRunner.query(`
            CREATE TABLE "user_groups" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "user_id" INTEGER NOT NULL,
                "group_id" INTEGER NOT NULL,
                "is_admin" BOOLEAN NOT NULL DEFAULT 0,
                "permissions" TEXT,
                "joined_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "last_active" DATETIME,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
            )
        `);

    // Create user_permission table (singular)
    await queryRunner.query(`
            CREATE TABLE "user_permission" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "user_id" INTEGER NOT NULL,
                "permission_id" INTEGER NOT NULL,
                "granted" BOOLEAN NOT NULL DEFAULT 1,
                "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_permission"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_groups"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "api_endpoint_permissions"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "frontend_route_permissions"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ui_component_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "group_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "role_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "api_endpoints"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "frontend_routes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ui_components"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "groups"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "permissions"`);
  }
}
