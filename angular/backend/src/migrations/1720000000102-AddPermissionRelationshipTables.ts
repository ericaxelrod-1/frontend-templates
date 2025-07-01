import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPermissionRelationshipTables1720000000102
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create components table if it doesn't exist
    const hasComponentsTable = await queryRunner.hasTable('components');
    if (!hasComponentsTable) {
      await queryRunner.query(`
        CREATE TABLE "components" (
          "id" SERIAL PRIMARY KEY,
          "name" varchar NOT NULL UNIQUE,
          "selector" varchar,
          "description" varchar,
          "override_permissions" boolean DEFAULT false,
          "last_synced" timestamp,
          "module" varchar,
          "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }

    // Create component_permissions join table if it doesn't exist
    const hasComponentPermissionsTable = await queryRunner.hasTable(
      'component_permissions',
    );
    if (!hasComponentPermissionsTable) {
      await queryRunner.query(`
        CREATE TABLE "component_permissions" (
          "component_id" integer NOT NULL,
          "permission_id" integer NOT NULL,
          PRIMARY KEY ("component_id", "permission_id")
        )
      `);

      await queryRunner.query(`
        ALTER TABLE "component_permissions"
        ADD CONSTRAINT "FK_component_permissions_component_id" FOREIGN KEY ("component_id")
        REFERENCES "components" ("id") ON DELETE CASCADE
      `);

      await queryRunner.query(`
        ALTER TABLE "component_permissions"
        ADD CONSTRAINT "FK_component_permissions_permission_id" FOREIGN KEY ("permission_id")
        REFERENCES "permissions" ("id") ON DELETE CASCADE
      `);
    }

    // Create api_endpoints table if it doesn't exist
    const hasApiEndpointsTable = await queryRunner.hasTable('api_endpoints');
    if (!hasApiEndpointsTable) {
      await queryRunner.query(`
        CREATE TABLE "api_endpoints" (
          "id" SERIAL PRIMARY KEY,
          "method" varchar NOT NULL,
          "path" varchar NOT NULL,
          "description" varchar,
          "controller_name" varchar,
          "handler_name" varchar,
          "override_permissions" boolean DEFAULT false,
          "last_synced" timestamp,
          "disabled" boolean DEFAULT false,
          "requires_auth" boolean DEFAULT true,
          "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
          UNIQUE ("method", "path")
        )
      `);
    }

    // Create api_endpoint_permissions join table if it doesn't exist
    const hasApiEndpointPermissionsTable = await queryRunner.hasTable(
      'api_endpoint_permissions',
    );
    if (!hasApiEndpointPermissionsTable) {
      await queryRunner.query(`
        CREATE TABLE "api_endpoint_permissions" (
          "endpoint_id" integer NOT NULL,
          "permission_id" integer NOT NULL,
          PRIMARY KEY ("endpoint_id", "permission_id")
        )
      `);

      await queryRunner.query(`
        ALTER TABLE "api_endpoint_permissions"
        ADD CONSTRAINT "FK_api_endpoint_permissions_endpoint_id" FOREIGN KEY ("endpoint_id")
        REFERENCES "api_endpoints" ("id") ON DELETE CASCADE
      `);

      await queryRunner.query(`
        ALTER TABLE "api_endpoint_permissions"
        ADD CONSTRAINT "FK_api_endpoint_permissions_permission_id" FOREIGN KEY ("permission_id")
        REFERENCES "permissions" ("id") ON DELETE CASCADE
      `);
    }

    // Create frontend_routes table if it doesn't exist
    const hasFrontendRoutesTable =
      await queryRunner.hasTable('frontend_routes');
    if (!hasFrontendRoutesTable) {
      await queryRunner.query(`
        CREATE TABLE "frontend_routes" (
          "id" SERIAL PRIMARY KEY,
          "path" varchar NOT NULL UNIQUE,
          "title" varchar,
          "description" varchar,
          "component" varchar,
          "override_permissions" boolean DEFAULT false,
          "last_synced" timestamp,
          "disabled" boolean DEFAULT false,
          "show_in_menu" boolean DEFAULT true,
          "icon" varchar,
          "menu_order" integer DEFAULT 100,
          "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }

    // Create frontend_route_permissions join table if it doesn't exist
    const hasFrontendRoutePermissionsTable = await queryRunner.hasTable(
      'frontend_route_permissions',
    );
    if (!hasFrontendRoutePermissionsTable) {
      await queryRunner.query(`
        CREATE TABLE "frontend_route_permissions" (
          "route_id" integer NOT NULL,
          "permission_id" integer NOT NULL,
          PRIMARY KEY ("route_id", "permission_id")
        )
      `);

      await queryRunner.query(`
        ALTER TABLE "frontend_route_permissions"
        ADD CONSTRAINT "FK_frontend_route_permissions_route_id" FOREIGN KEY ("route_id")
        REFERENCES "frontend_routes" ("id") ON DELETE CASCADE
      `);

      await queryRunner.query(`
        ALTER TABLE "frontend_route_permissions"
        ADD CONSTRAINT "FK_frontend_route_permissions_permission_id" FOREIGN KEY ("permission_id")
        REFERENCES "permissions" ("id") ON DELETE CASCADE
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the join tables first
    const hasFrontendRoutePermissionsTable = await queryRunner.hasTable(
      'frontend_route_permissions',
    );
    if (hasFrontendRoutePermissionsTable) {
      await queryRunner.query(`DROP TABLE "frontend_route_permissions"`);
    }

    const hasApiEndpointPermissionsTable = await queryRunner.hasTable(
      'api_endpoint_permissions',
    );
    if (hasApiEndpointPermissionsTable) {
      await queryRunner.query(`DROP TABLE "api_endpoint_permissions"`);
    }

    const hasComponentPermissionsTable = await queryRunner.hasTable(
      'component_permissions',
    );
    if (hasComponentPermissionsTable) {
      await queryRunner.query(`DROP TABLE "component_permissions"`);
    }

    // Then drop the main tables
    const hasFrontendRoutesTable =
      await queryRunner.hasTable('frontend_routes');
    if (hasFrontendRoutesTable) {
      await queryRunner.query(`DROP TABLE "frontend_routes"`);
    }

    const hasApiEndpointsTable = await queryRunner.hasTable('api_endpoints');
    if (hasApiEndpointsTable) {
      await queryRunner.query(`DROP TABLE "api_endpoints"`);
    }

    const hasComponentsTable = await queryRunner.hasTable('components');
    if (hasComponentsTable) {
      await queryRunner.query(`DROP TABLE "components"`);
    }
  }
}
