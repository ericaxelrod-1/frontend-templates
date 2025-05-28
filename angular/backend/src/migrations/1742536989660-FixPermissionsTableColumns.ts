import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixPermissionsTableColumns1742536989660 implements MigrationInterface {
    name = 'FixPermissionsTableColumns1742536989660';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Check if the permissions table exists
        const permissionsTableExists = await queryRunner.hasTable('permissions');
        if (!permissionsTableExists) {
            console.log('Permissions table does not exist, creating it');
            // Create the permissions table
            await queryRunner.query(`
                CREATE TABLE "permissions" (
                    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                    "name" VARCHAR NOT NULL,
                    "description" VARCHAR,
                    "resource_name" VARCHAR,
                    "action" VARCHAR,
                    "action_id" INTEGER,
                    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
                    "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            console.log('Created permissions table');
            
            // If the permission table exists, copy data from it
            const permissionTableExists = await queryRunner.hasTable('permission');
            if (permissionTableExists) {
                console.log('Found old permission table, copying data to new permissions table');
                await queryRunner.query(`
                    INSERT INTO "permissions" (
                        "id", "name", "description", "created_at", "updated_at"
                    )
                    SELECT 
                        "id", "name", "description", "created_at", "updated_at"
                    FROM "permission"
                `);
                console.log('Copied data from permission to permissions table');
            }
        } else {
            console.log('Permissions table already exists');
        }

        // Check if resourceName column exists
        const resourceNameColumnExists = await queryRunner.hasColumn('permissions', 'resource_name');
        if (!resourceNameColumnExists) {
            // Add resourceName column if it doesn't exist
            await queryRunner.query(`
                ALTER TABLE "permissions" 
                ADD COLUMN "resource_name" VARCHAR DEFAULT NULL
            `);
            
            // Update resourceName values based on the name field (format: resource:action)
            await queryRunner.query(`
                UPDATE "permissions"
                SET "resource_name" = SUBSTR("name", 1, INSTR("name", ':') - 1)
                WHERE "resource_name" IS NULL AND INSTR("name", ':') > 0
            `);
            
            console.log('Added resource_name column and populated it from name values');
        } else {
            console.log('resource_name column already exists');
        }

        // Check if action column exists
        const actionColumnExists = await queryRunner.hasColumn('permissions', 'action');
        if (!actionColumnExists) {
            // Add action column if it doesn't exist
            await queryRunner.query(`
                ALTER TABLE "permissions" 
                ADD COLUMN "action" VARCHAR DEFAULT NULL
            `);
            
            // Update action values based on the name field (format: resource:action)
            await queryRunner.query(`
                UPDATE "permissions"
                SET "action" = SUBSTR("name", INSTR("name", ':') + 1)
                WHERE "action" IS NULL AND INSTR("name", ':') > 0
            `);
            
            console.log('Added action column and populated it from name values');
        } else {
            console.log('action column already exists');
        }

        // Create indexes for better query performance
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_permissions_resource_name" 
            ON "permissions" ("resource_name")
        `);
        
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_permissions_action" 
            ON "permissions" ("action")
        `);
        
        console.log('Successfully updated permissions table with resource_name and action columns');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // We're just adding columns, so for rollback we would drop the columns
        // However, that could break existing code, so we'll just drop the indexes
        
        try {
            await queryRunner.query(`DROP INDEX IF EXISTS "idx_permissions_resource_name"`);
            await queryRunner.query(`DROP INDEX IF EXISTS "idx_permissions_action"`);
            
            console.log('Removed indexes for resource_name and action columns');
            console.log('Note: The columns themselves were not removed to avoid breaking existing code');
        } catch (error) {
            console.error('Error rolling back migration:', error);
            throw error;
        }
    }
} 