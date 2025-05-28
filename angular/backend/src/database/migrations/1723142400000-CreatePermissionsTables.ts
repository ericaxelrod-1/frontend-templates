import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePermissionsTables1723142400000
  implements MigrationInterface
{
  name = 'CreatePermissionsTables1723142400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create permissions table
    await queryRunner.query(`
            CREATE TABLE "permissions" (
                "id" varchar PRIMARY KEY NOT NULL,
                "resourceName" varchar NOT NULL,
                "actionName" varchar NOT NULL,
                "name" varchar NOT NULL,
                "description" varchar,
                "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
                "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
            )
        `);

    // Create roles table in permissions module (different from users/roles)
    await queryRunner.query(`
            CREATE TABLE "roles" (
                "id" varchar PRIMARY KEY NOT NULL,
                "name" varchar NOT NULL UNIQUE,
                "description" varchar,
                "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
                "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
            )
        `);

    // Create groups table in permissions module
    await queryRunner.query(`
            CREATE TABLE "groups" (
                "id" varchar PRIMARY KEY NOT NULL,
                "name" varchar NOT NULL UNIQUE,
                "description" varchar,
                "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
                "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
            )
        `);

    // Create role_permissions join table
    await queryRunner.query(`
            CREATE TABLE "role_permissions" (
                "role_id" varchar NOT NULL,
                "permission_id" varchar NOT NULL,
                PRIMARY KEY ("role_id", "permission_id"),
                CONSTRAINT "FK_role_permissions_role" FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                CONSTRAINT "FK_role_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);

    // Create group_permissions join table
    await queryRunner.query(`
            CREATE TABLE "group_permissions" (
                "group_id" varchar NOT NULL,
                "permission_id" varchar NOT NULL,
                PRIMARY KEY ("group_id", "permission_id"),
                CONSTRAINT "FK_group_permissions_group" FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                CONSTRAINT "FK_group_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);

    // Create user_permission table
    await queryRunner.query(`
            CREATE TABLE "user_permission" (
                "userId" integer NOT NULL,
                "permissionId" integer NOT NULL,
                "granted" boolean NOT NULL DEFAULT (1),
                "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
                "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY ("userId", "permissionId"),
                CONSTRAINT "FK_user_permission_user" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                CONSTRAINT "FK_user_permission_permission" FOREIGN KEY ("permissionId") REFERENCES "permissions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);

    // Create ui_components table
    await queryRunner.query(`
            CREATE TABLE "ui_components" (
                "id" varchar PRIMARY KEY NOT NULL,
                "selector" varchar NOT NULL UNIQUE,
                "description" varchar,
                "filePath" varchar,
                "overridePermissions" boolean NOT NULL DEFAULT (0),
                "lastSynced" datetime,
                "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
                "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
            )
        `);

    // Create ui_component_permissions join table
    await queryRunner.query(`
            CREATE TABLE "ui_component_permissions" (
                "component_id" varchar NOT NULL,
                "permission_id" varchar NOT NULL,
                PRIMARY KEY ("component_id", "permission_id"),
                CONSTRAINT "FK_ui_component_permissions_component" FOREIGN KEY ("component_id") REFERENCES "ui_components" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                CONSTRAINT "FK_ui_component_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);

    // Create frontend_routes table
    await queryRunner.query(`
            CREATE TABLE "frontend_routes" (
                "id" varchar PRIMARY KEY NOT NULL,
                "path" varchar NOT NULL UNIQUE,
                "description" varchar,
                "component" varchar,
                "overridePermissions" boolean NOT NULL DEFAULT (0),
                "lastSynced" datetime,
                "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
                "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
            )
        `);

    // Create frontend_route_permissions join table
    await queryRunner.query(`
            CREATE TABLE "frontend_route_permissions" (
                "route_id" varchar NOT NULL,
                "permission_id" varchar NOT NULL,
                PRIMARY KEY ("route_id", "permission_id"),
                CONSTRAINT "FK_frontend_route_permissions_route" FOREIGN KEY ("route_id") REFERENCES "frontend_routes" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                CONSTRAINT "FK_frontend_route_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);

    // Create api_endpoints table
    await queryRunner.query(`
            CREATE TABLE "api_endpoints" (
                "id" varchar PRIMARY KEY NOT NULL,
                "method" varchar NOT NULL,
                "path" varchar NOT NULL,
                "description" varchar,
                "controllerName" varchar,
                "handlerName" varchar,
                "overridePermissions" boolean NOT NULL DEFAULT (0),
                "lastSynced" datetime,
                "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
                "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
            )
        `);

    // Create api_endpoint_permissions join table
    await queryRunner.query(`
            CREATE TABLE "api_endpoint_permissions" (
                "endpoint_id" varchar NOT NULL,
                "permission_id" varchar NOT NULL,
                PRIMARY KEY ("endpoint_id", "permission_id"),
                CONSTRAINT "FK_api_endpoint_permissions_endpoint" FOREIGN KEY ("endpoint_id") REFERENCES "api_endpoints" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                CONSTRAINT "FK_api_endpoint_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);

    // Create unique index on permission name
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_PERMISSION_NAME" ON "permissions" ("name")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order
    await queryRunner.query(`DROP TABLE "api_endpoint_permissions"`);
    await queryRunner.query(`DROP TABLE "api_endpoints"`);
    await queryRunner.query(`DROP TABLE "frontend_route_permissions"`);
    await queryRunner.query(`DROP TABLE "frontend_routes"`);
    await queryRunner.query(`DROP TABLE "ui_component_permissions"`);
    await queryRunner.query(`DROP TABLE "ui_components"`);
    await queryRunner.query(`DROP TABLE "user_permission"`);
    await queryRunner.query(`DROP TABLE "group_permissions"`);
    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP TABLE "groups"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
  }
}
