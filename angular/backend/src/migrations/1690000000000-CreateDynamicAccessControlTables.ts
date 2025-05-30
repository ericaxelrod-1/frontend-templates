import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDynamicAccessControlTables1690000000000
  implements MigrationInterface
{
  name = 'CreateDynamicAccessControlTables1690000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // First check if permissions table already exists
    const permissionsTableExists = await queryRunner.hasTable('permission');

    // Create permissions table with new structure if it doesn't already exist
    if (!permissionsTableExists) {
      await queryRunner.query(`
                CREATE TABLE "permission" (
                    "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
                    "resourceName" varchar(50) NOT NULL,
                    "actionName" varchar(50) NOT NULL,
                    "name" varchar(100) NOT NULL UNIQUE,
                    "description" text,
                    "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                    "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                    UNIQUE("resourceName", "actionName")
                )
            `);
    }
    // If it exists, update it with the new structure
    else {
      // Check if columns already exist before adding them
      const hasResourceNameColumn = await queryRunner.hasColumn(
        'permission',
        'resourceName',
      );
      const hasActionNameColumn = await queryRunner.hasColumn(
        'permission',
        'actionName',
      );

      if (!hasResourceNameColumn) {
        await queryRunner.query(
          `ALTER TABLE "permission" ADD COLUMN "resourceName" varchar(50)`,
        );
      }

      if (!hasActionNameColumn) {
        await queryRunner.query(
          `ALTER TABLE "permission" ADD COLUMN "actionName" varchar(50)`,
        );
      }

      // Add the unique constraint if it doesn't exist
      try {
        await queryRunner.query(
          `ALTER TABLE "permission" ADD CONSTRAINT "UQ_permission_resource_action" UNIQUE("resourceName", "actionName")`,
        );
      } catch (err) {
        console.log('Constraint may already exist:', err.message);
      }
    }

    // Create ui_components table
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "ui_components" (
                "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
                "selector" varchar(100) NOT NULL UNIQUE,
                "description" text,
                "filePath" varchar(255),
                "overridePermissions" boolean NOT NULL DEFAULT false,
                "lastSynced" TIMESTAMP,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
            )
        `);

    // Create frontend_routes table
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "frontend_routes" (
                "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
                "path" varchar(255) NOT NULL UNIQUE,
                "description" text,
                "component" varchar(100),
                "overridePermissions" boolean NOT NULL DEFAULT false,
                "lastSynced" TIMESTAMP,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
            )
        `);

    // Create api_endpoints table
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "api_endpoints" (
                "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
                "method" varchar(20) NOT NULL,
                "path" varchar(255) NOT NULL,
                "description" text,
                "controllerName" varchar(100),
                "handlerName" varchar(100),
                "overridePermissions" boolean NOT NULL DEFAULT false,
                "lastSynced" TIMESTAMP,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                UNIQUE("method", "path")
            )
        `);

    // Create role_permissions junction table if it doesn't exist
    const rolePermissionsExists =
      await queryRunner.hasTable('role_permissions');
    if (!rolePermissionsExists) {
      await queryRunner.query(`
                CREATE TABLE "role_permissions" (
                    "role_id" uuid NOT NULL,
                    "permission_id" uuid NOT NULL,
                    PRIMARY KEY ("role_id", "permission_id"),
                    CONSTRAINT "FK_role_permissions_role" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE,
                    CONSTRAINT "FK_role_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
                )
            `);

      await queryRunner.query(
        `CREATE INDEX "IDX_role_permissions_role_id" ON "role_permissions" ("role_id")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_role_permissions_permission_id" ON "role_permissions" ("permission_id")`,
      );
    }

    // Create group_permissions junction table
    const groupPermissionsExists =
      await queryRunner.hasTable('group_permissions');
    if (!groupPermissionsExists) {
      await queryRunner.query(`
                CREATE TABLE "group_permissions" (
                    "group_id" uuid NOT NULL,
                    "permission_id" uuid NOT NULL,
                    PRIMARY KEY ("group_id", "permission_id"),
                    CONSTRAINT "FK_group_permissions_group" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE CASCADE,
                    CONSTRAINT "FK_group_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
                )
            `);

      await queryRunner.query(
        `CREATE INDEX "IDX_group_permissions_group_id" ON "group_permissions" ("group_id")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_group_permissions_permission_id" ON "group_permissions" ("permission_id")`,
      );
    }

    // Create ui_component_permissions junction table
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "ui_component_permissions" (
                "component_id" uuid NOT NULL,
                "permission_id" uuid NOT NULL,
                PRIMARY KEY ("component_id", "permission_id"),
                CONSTRAINT "FK_ui_component_permissions_component" FOREIGN KEY ("component_id") REFERENCES "ui_components"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_ui_component_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
            )
        `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ui_component_permissions_component_id" ON "ui_component_permissions" ("component_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ui_component_permissions_permission_id" ON "ui_component_permissions" ("permission_id")`,
    );

    // Create frontend_route_permissions junction table
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "frontend_route_permissions" (
                "route_id" uuid NOT NULL,
                "permission_id" uuid NOT NULL,
                PRIMARY KEY ("route_id", "permission_id"),
                CONSTRAINT "FK_frontend_route_permissions_route" FOREIGN KEY ("route_id") REFERENCES "frontend_routes"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_frontend_route_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
            )
        `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_frontend_route_permissions_route_id" ON "frontend_route_permissions" ("route_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_frontend_route_permissions_permission_id" ON "frontend_route_permissions" ("permission_id")`,
    );

    // Create api_endpoint_permissions junction table
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "api_endpoint_permissions" (
                "endpoint_id" uuid NOT NULL,
                "permission_id" uuid NOT NULL,
                PRIMARY KEY ("endpoint_id", "permission_id"),
                CONSTRAINT "FK_api_endpoint_permissions_endpoint" FOREIGN KEY ("endpoint_id") REFERENCES "api_endpoints"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_api_endpoint_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
            )
        `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_api_endpoint_permissions_endpoint_id" ON "api_endpoint_permissions" ("endpoint_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_api_endpoint_permissions_permission_id" ON "api_endpoint_permissions" ("permission_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop junction tables first
    await queryRunner.query(`DROP TABLE IF EXISTS "api_endpoint_permissions"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "frontend_route_permissions"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ui_component_permissions"`);

    // Drop main tables
    await queryRunner.query(`DROP TABLE IF EXISTS "api_endpoints"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "frontend_routes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ui_components"`);

    // Don't drop permission and role/group tables in case they have other data
    // Just remove the added columns if needed
    await queryRunner.query(`
            ALTER TABLE "permission" 
            DROP COLUMN IF EXISTS "resourceName",
            DROP COLUMN IF EXISTS "actionName"
        `);
  }
}
