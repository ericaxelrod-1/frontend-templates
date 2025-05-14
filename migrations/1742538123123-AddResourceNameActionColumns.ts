import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddResourceNameActionColumns1742538123123 implements MigrationInterface {
  name = 'AddResourceNameActionColumns1742538123123';

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('Starting migration to add resource_name and action columns...');
    
    // Check if permissions table exists
    const tableExists = await queryRunner.hasTable('permissions');
    if (!tableExists) {
      console.log('Permissions table does not exist, creating it...');
      
      // Create permissions table from scratch with all required columns
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
      
      console.log('Permissions table created successfully.');
      return;
    }
    
    // Get current columns in permissions table
    const columns = await queryRunner.query("PRAGMA table_info(permissions)");
    const columnNames = columns.map(col => col.name);
    
    console.log(`Current columns in permissions table: ${columnNames.join(', ')}`);
    
    // Add resource_name column if it doesn't exist
    if (!columnNames.includes('resource_name')) {
      console.log('Adding resource_name column to permissions table...');
      await queryRunner.query(`ALTER TABLE "permissions" ADD "resource_name" VARCHAR(50)`);
      
      // Update resource_name from name field
      await queryRunner.query(`
        UPDATE "permissions"
        SET "resource_name" = SUBSTR("name", 1, INSTR("name", ':') - 1)
        WHERE INSTR("name", ':') > 0
      `);
      
      console.log('resource_name column added and populated successfully.');
    }
    
    // Add action column if it doesn't exist
    if (!columnNames.includes('action')) {
      console.log('Adding action column to permissions table...');
      await queryRunner.query(`ALTER TABLE "permissions" ADD "action" VARCHAR(50)`);
      
      // Update action from name field
      await queryRunner.query(`
        UPDATE "permissions"
        SET "action" = SUBSTR("name", INSTR("name", ':') + 1)
        WHERE INSTR("name", ':') > 0
      `);
      
      console.log('action column added and populated successfully.');
    }
    
    // Create indexes if they don't exist
    console.log('Adding indexes for faster queries...');
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_permissions_name" ON "permissions" ("name")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_permissions_resource_name" ON "permissions" ("resource_name")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_permissions_action" ON "permissions" ("action")`);
    
    console.log('Migration completed successfully!');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This is a critical structural change that shouldn't be rolled back
    // But we'll provide a safe downgrade path that preserves data
    console.log('Rolling back resource_name and action columns (not recommended)...');
    
    // Check if permissions table exists
    const tableExists = await queryRunner.hasTable('permissions');
    if (!tableExists) {
      console.log('Permissions table does not exist, nothing to roll back.');
      return;
    }
    
    // Drop indexes first
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_permissions_resource_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_permissions_action"`);
    
    // Get current columns in permissions table
    const columns = await queryRunner.query("PRAGMA table_info(permissions)");
    const columnNames = columns.map(col => col.name);
    
    // In SQLite, we can't directly drop columns, but we can create a new table without them
    // and copy the data over. However, since these columns are important, we'll just log a warning.
    console.log('WARNING: Cannot directly drop columns in SQLite.');
    console.log('For a full rollback, manually create a new table without the columns and copy data.');
  }
} 