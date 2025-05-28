import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixPermissionsTableMissingColumns1742536989661 implements MigrationInterface {
    name = 'FixPermissionsTableMissingColumns1742536989661';

    public async up(queryRunner: QueryRunner): Promise<void> {
        console.log('Starting migration to fix permissions table missing columns...');
        
        // Check if permissions table exists
        const permissionsTableExists = await queryRunner.hasTable('permissions');
        if (!permissionsTableExists) {
            console.log('Error: permissions table does not exist, cannot proceed');
            return;
        }
        
        // Get current columns
        const columns = await queryRunner.query("PRAGMA table_info(permissions)");
        const columnNames = columns.map((col: any) => col.name);
        console.log(`Current columns in permissions table: ${columnNames.join(', ')}`);
        
        // Check if resource_name column exists
        if (!columnNames.includes('resource_name')) {
            console.log('Adding resource_name column to permissions table');
            await queryRunner.query(`
                ALTER TABLE "permissions" 
                ADD COLUMN "resource_name" VARCHAR(50)
            `);
            
            // Update resource_name values based on the name field (format: resource:action)
            await queryRunner.query(`
                UPDATE "permissions"
                SET "resource_name" = SUBSTR("name", 1, INSTR("name", ':') - 1)
                WHERE INSTR("name", ':') > 0
            `);
        } else {
            console.log('resource_name column already exists');
        }
        
        // Check if action column exists
        if (!columnNames.includes('action')) {
            console.log('Adding action column to permissions table');
            await queryRunner.query(`
                ALTER TABLE "permissions" 
                ADD COLUMN "action" VARCHAR(50)
            `);
            
            // Update action values based on the name field (format: resource:action)
            await queryRunner.query(`
                UPDATE "permissions"
                SET "action" = SUBSTR("name", INSTR("name", ':') + 1)
                WHERE INSTR("name", ':') > 0
            `);
        } else {
            console.log('action column already exists');
        }
        
        // Create indexes for better query performance
        console.log('Creating indexes on resource_name and action columns');
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_permissions_resource_name" 
            ON "permissions" ("resource_name")
        `);
        
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_permissions_action" 
            ON "permissions" ("action")
        `);
        
        // Check if columns were added successfully
        const updatedColumns = await queryRunner.query("PRAGMA table_info(permissions)");
        const updatedColumnNames = updatedColumns.map((col: any) => col.name);
        console.log(`Updated columns in permissions table: ${updatedColumnNames.join(', ')}`);
        
        console.log('Migration completed successfully');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Dropping columns is not supported in SQLite, so we can only drop the indexes
        console.log('Rolling back migration (dropping indexes only)');
        
        try {
            await queryRunner.query(`DROP INDEX IF EXISTS "idx_permissions_resource_name"`);
            await queryRunner.query(`DROP INDEX IF EXISTS "idx_permissions_action"`);
            
            console.log('Rolled back migration (indexes only)');
        } catch (error) {
            console.error('Error rolling back migration:', error);
            throw error;
        }
    }
} 