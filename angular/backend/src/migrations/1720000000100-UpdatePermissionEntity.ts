import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdatePermissionEntity1720000000100 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if the action_name column already exists
    const hasActionNameColumn = await queryRunner.hasColumn('permissions', 'action_name');
    if (!hasActionNameColumn) {
      // First, create a backup of the permissions table
      await queryRunner.query(`CREATE TABLE "permissions_backup" AS SELECT * FROM "permissions"`);

      // Add actionName column - this will be a copy of the action column initially
      await queryRunner.query(`ALTER TABLE "permissions" ADD "action_name" varchar`);

      // Update action_name to match action for existing records
      await queryRunner.query(`UPDATE "permissions" SET "action_name" = "action"`);

      // Make action_name NOT NULL
      await queryRunner.query(`ALTER TABLE "permissions" ALTER COLUMN "action_name" SET NOT NULL`);

      // Rename action column to actionName (for backward compatibility)
      await queryRunner.query(`ALTER TABLE "permissions" RENAME COLUMN "action" TO "actionName"`);
    }

    // Update permissions table to ensure proper field names for resource_name
    const hasResourceNameColumn = await queryRunner.hasColumn('permissions', 'resource_name');
    if (!hasResourceNameColumn) {
      // Rename resourceName to resource_name if it exists in camelCase
      const hasResourceNameCamelCase = await queryRunner.hasColumn('permissions', 'resourceName');
      if (hasResourceNameCamelCase) {
        await queryRunner.query(`ALTER TABLE "permissions" RENAME COLUMN "resourceName" TO "resource_name"`);
      } else {
        // Add resource_name column if it doesn't exist
        await queryRunner.query(`ALTER TABLE "permissions" ADD "resource_name" varchar`);
        await queryRunner.query(`UPDATE "permissions" SET "resource_name" = 'unknown' WHERE "resource_name" IS NULL`);
        await queryRunner.query(`ALTER TABLE "permissions" ALTER COLUMN "resource_name" SET NOT NULL`);
      }
    }

    // Add missing relationship tables if they don't exist

    // Check if role_permissions table exists
    const hasRolePermissionsTable = await queryRunner.hasTable('role_permissions');
    if (!hasRolePermissionsTable) {
      await queryRunner.query(`
        CREATE TABLE "role_permissions" (
          "id" SERIAL PRIMARY KEY,
          "role_id" integer NOT NULL,
          "permission_id" integer NOT NULL,
          "granted" boolean DEFAULT true NOT NULL,
          "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await queryRunner.query(`
        ALTER TABLE "role_permissions"
        ADD CONSTRAINT "FK_role_permissions_role_id" FOREIGN KEY ("role_id")
        REFERENCES "roles" ("id") ON DELETE CASCADE
      `);

      await queryRunner.query(`
        ALTER TABLE "role_permissions"
        ADD CONSTRAINT "FK_role_permissions_permission_id" FOREIGN KEY ("permission_id")
        REFERENCES "permissions" ("id") ON DELETE CASCADE
      `);
    } else {
      // Check if granted column exists in role_permissions
      const hasGrantedColumn = await queryRunner.hasColumn('role_permissions', 'granted');
      if (!hasGrantedColumn) {
        await queryRunner.query(`ALTER TABLE "role_permissions" ADD "granted" boolean DEFAULT true NOT NULL`);
      }
    }

    // Check if group_permissions table exists
    const hasGroupPermissionsTable = await queryRunner.hasTable('group_permissions');
    if (!hasGroupPermissionsTable) {
      await queryRunner.query(`
        CREATE TABLE "group_permissions" (
          "id" SERIAL PRIMARY KEY,
          "group_id" integer NOT NULL,
          "permission_id" integer NOT NULL,
          "granted" boolean DEFAULT true NOT NULL,
          "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await queryRunner.query(`
        ALTER TABLE "group_permissions"
        ADD CONSTRAINT "FK_group_permissions_group_id" FOREIGN KEY ("group_id")
        REFERENCES "groups" ("id") ON DELETE CASCADE
      `);

      await queryRunner.query(`
        ALTER TABLE "group_permissions"
        ADD CONSTRAINT "FK_group_permissions_permission_id" FOREIGN KEY ("permission_id")
        REFERENCES "permissions" ("id") ON DELETE CASCADE
      `);
    } else {
      // Check if granted column exists in group_permissions
      const hasGrantedColumn = await queryRunner.hasColumn('group_permissions', 'granted');
      if (!hasGrantedColumn) {
        await queryRunner.query(`ALTER TABLE "group_permissions" ADD "granted" boolean DEFAULT true NOT NULL`);
      }
    }

    // Check if user_permission table exists
    const hasUserPermissionTable = await queryRunner.hasTable('user_permission');
    if (!hasUserPermissionTable) {
      await queryRunner.query(`
        CREATE TABLE "user_permission" (
          "id" SERIAL PRIMARY KEY,
          "user_id" integer NOT NULL,
          "permission_id" integer NOT NULL,
          "granted" boolean DEFAULT true NOT NULL,
          "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await queryRunner.query(`
        ALTER TABLE "user_permission"
        ADD CONSTRAINT "FK_user_permission_user_id" FOREIGN KEY ("user_id")
        REFERENCES "users" ("id") ON DELETE CASCADE
      `);

      await queryRunner.query(`
        ALTER TABLE "user_permission"
        ADD CONSTRAINT "FK_user_permission_permission_id" FOREIGN KEY ("permission_id")
        REFERENCES "permissions" ("id") ON DELETE CASCADE
      `);
    } else {
      // Check if granted column exists in user_permission
      const hasGrantedColumn = await queryRunner.hasColumn('user_permission', 'granted');
      if (!hasGrantedColumn) {
        await queryRunner.query(`ALTER TABLE "user_permission" ADD "granted" boolean DEFAULT true NOT NULL`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert changes to permissions table
    const hasBackupTable = await queryRunner.hasTable('permissions_backup');
    if (hasBackupTable) {
      // Drop the current table with the new schema
      await queryRunner.query(`DROP TABLE "permissions"`);
      
      // Rename the backup table to restore the original schema
      await queryRunner.query(`ALTER TABLE "permissions_backup" RENAME TO "permissions"`);
    } else {
      // If no backup table exists, try to revert individual changes
      const hasActionNameColumn = await queryRunner.hasColumn('permissions', 'action_name');
      if (hasActionNameColumn) {
        // Rename actionName back to action
        const hasActionNameCamelCase = await queryRunner.hasColumn('permissions', 'actionName');
        if (hasActionNameCamelCase) {
          await queryRunner.query(`ALTER TABLE "permissions" RENAME COLUMN "actionName" TO "action"`);
        }
        
        // Drop the action_name column
        await queryRunner.query(`ALTER TABLE "permissions" DROP COLUMN "action_name"`);
      }
      
      // Revert resource_name changes
      const hasResourceNameColumn = await queryRunner.hasColumn('permissions', 'resource_name');
      if (hasResourceNameColumn) {
        const hasResourceNameCamelCase = await queryRunner.hasColumn('permissions', 'resourceName');
        if (!hasResourceNameCamelCase) {
          await queryRunner.query(`ALTER TABLE "permissions" RENAME COLUMN "resource_name" TO "resourceName"`);
        }
      }
    }

    // Keep the relationship tables as they might be used by other parts of the application
    // Their removal should be handled by separate migrations if needed
  }
} 