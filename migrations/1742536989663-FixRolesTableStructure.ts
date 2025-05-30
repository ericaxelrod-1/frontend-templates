import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixRolesTableStructure1742536989663 implements MigrationInterface {
    name = 'FixRolesTableStructure1742536989663';

    public async up(queryRunner: QueryRunner): Promise<void> {
        console.log('Starting migration to fix roles table structure...');
        
        // Check if roles table exists
        const rolesTableExists = await queryRunner.hasTable('roles');
        
        // If roles table doesn't exist, create it from scratch
        if (!rolesTableExists) {
            console.log('Creating roles table...');
            
            await queryRunner.query(`
                CREATE TABLE "roles" (
                    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                    "name" VARCHAR(100) UNIQUE NOT NULL,
                    "description" TEXT,
                    "is_system_role" BOOLEAN DEFAULT 0,
                    "is_default" BOOLEAN DEFAULT 0,
                    "parent_id" INTEGER,
                    "priority" INTEGER DEFAULT 0,
                    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
                    "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY ("parent_id") REFERENCES "roles" ("id") ON DELETE SET NULL
                )
            `);
            
            console.log('Creating indexes for roles table...');
            await queryRunner.query(`CREATE INDEX "idx_roles_name" ON "roles" ("name")`);
            await queryRunner.query(`CREATE INDEX "idx_roles_is_default" ON "roles" ("is_default")`);
            
            // Create the admin role
            console.log('Creating admin role...');
            await queryRunner.query(`
                INSERT INTO "roles" ("name", "description", "is_system_role", "is_default", "priority")
                VALUES ('admin', 'Administrator with full system access', 1, 0, 100)
            `);
            
            // Create the user role
            console.log('Creating user role...');
            await queryRunner.query(`
                INSERT INTO "roles" ("name", "description", "is_system_role", "is_default", "priority")
                VALUES ('user', 'Default user role', 1, 1, 10)
            `);
            
            console.log('Roles table created successfully with default roles.');
        } else {
            console.log('Roles table already exists, checking if it has the correct structure...');
            
            // Get columns in the roles table
            const columns = await queryRunner.query(`PRAGMA table_info(roles)`);
            const columnNames = columns.map((col: any) => col.name);
            
            console.log(`Existing columns: ${columnNames.join(', ')}`);
            
            // Add missing columns if needed
            if (!columnNames.includes('is_system_role')) {
                console.log('Adding is_system_role column...');
                await queryRunner.query(`ALTER TABLE "roles" ADD COLUMN "is_system_role" BOOLEAN DEFAULT 0`);
            }
            
            if (!columnNames.includes('is_default')) {
                console.log('Adding is_default column...');
                await queryRunner.query(`ALTER TABLE "roles" ADD COLUMN "is_default" BOOLEAN DEFAULT 0`);
            }
            
            if (!columnNames.includes('parent_id')) {
                console.log('Adding parent_id column...');
                await queryRunner.query(`ALTER TABLE "roles" ADD COLUMN "parent_id" INTEGER REFERENCES "roles" ("id") ON DELETE SET NULL`);
            }
            
            if (!columnNames.includes('priority')) {
                console.log('Adding priority column...');
                await queryRunner.query(`ALTER TABLE "roles" ADD COLUMN "priority" INTEGER DEFAULT 0`);
            }
            
            // Check if default roles exist, and create them if they don't
            const adminRole = await queryRunner.query(`SELECT * FROM "roles" WHERE "name" = 'admin' LIMIT 1`);
            
            if (!adminRole.length) {
                console.log('Creating admin role...');
                await queryRunner.query(`
                    INSERT INTO "roles" ("name", "description", "is_system_role", "is_default", "priority")
                    VALUES ('admin', 'Administrator with full system access', 1, 0, 100)
                `);
            }
            
            const userRole = await queryRunner.query(`SELECT * FROM "roles" WHERE "name" = 'user' LIMIT 1`);
            
            if (!userRole.length) {
                console.log('Creating user role...');
                await queryRunner.query(`
                    INSERT INTO "roles" ("name", "description", "is_system_role", "is_default", "priority")
                    VALUES ('user', 'Default user role', 1, 1, 10)
                `);
            }
            
            console.log('Roles table structure updated successfully.');
        }
        
        // Now check if role_permissions table exists with proper structure
        const rolePermissionsTableExists = await queryRunner.hasTable('role_permissions');
        
        if (!rolePermissionsTableExists) {
            console.log('Creating role_permissions table...');
            
            await queryRunner.query(`
                CREATE TABLE "role_permissions" (
                    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                    "role_id" INTEGER NOT NULL,
                    "permission_id" INTEGER NOT NULL,
                    "granted" BOOLEAN DEFAULT 1,
                    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
                    "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE CASCADE,
                    FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE,
                    UNIQUE ("role_id", "permission_id")
                )
            `);
            
            console.log('Creating indexes for role_permissions table...');
            await queryRunner.query(`CREATE INDEX "idx_role_permissions_role_id" ON "role_permissions" ("role_id")`);
            await queryRunner.query(`CREATE INDEX "idx_role_permissions_permission_id" ON "role_permissions" ("permission_id")`);
            
            console.log('Role_permissions table created successfully.');
        } else {
            console.log('Role_permissions table already exists.');
        }
        
        console.log('Migration completed successfully.');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // We don't want to drop the roles table in production, so this is a no-op
        console.log('No-op down migration for roles table.');
    }
} 