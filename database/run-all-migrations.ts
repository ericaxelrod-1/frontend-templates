import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { DirectAddMissingColumns1742536989662 } from '../migrations/1742536989662-DirectAddMissingColumns';
import { FixRolesTableStructure1742536989663 } from '../migrations/1742536989663-FixRolesTableStructure';

// Load environment variables
config();

/**
 * This script runs a direct migration to fix the permissions table schema.
 */
async function runAllMigrations() {
  console.log('Starting permissions and roles schema alignment migration...');
  console.log('This will ensure permissions and roles tables have the correct structure and relationships.');

  const dataSource = new DataSource({
    type: 'sqlite',
    database: process.env.DATABASE_PATH || './src/database/database.sqlite',
    synchronize: false,
    logging: true,
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [
      DirectAddMissingColumns1742536989662,
      FixRolesTableStructure1742536989663
    ],
    subscribers: [],
  });

  try {
    await dataSource.initialize();
    console.log('Data source has been initialized!');

    // Run the direct migrations
    const permissionsMigration = new DirectAddMissingColumns1742536989662();
    console.log(`Running migration: ${permissionsMigration.name}`);
    await permissionsMigration.up(dataSource.createQueryRunner());
    console.log(`Successfully completed migration: ${permissionsMigration.name}`);

    const rolesMigration = new FixRolesTableStructure1742536989663();
    console.log(`Running migration: ${rolesMigration.name}`);
    await rolesMigration.up(dataSource.createQueryRunner());
    console.log(`Successfully completed migration: ${rolesMigration.name}`);

    console.log('Migrations completed successfully!');

    // Verify the schema is now correct
    const queryRunner = dataSource.createQueryRunner();
    
    // Check if permissions table exists
    const permissionsTableExists = await queryRunner.hasTable('permissions');
    console.log(`Permissions table exists: ${permissionsTableExists}`);

    // Check if permission table exists (should be removed or replaced)
    const permissionTableExists = await queryRunner.hasTable('permission');
    console.log(`Permission table exists: ${permissionTableExists}`);
    
    if (permissionsTableExists) {
      // Check if the permissions table has the required columns
      const columns = await queryRunner.query("PRAGMA table_info(permissions)");
      const columnNames = columns.map((col: any) => col.name);
      
      console.log("Permissions table columns:", columnNames.join(', '));
      
      const resourceNameColumnExists = columnNames.includes('resource_name');
      const actionColumnExists = columnNames.includes('action');
      
      console.log(`Permissions table has resource_name column: ${resourceNameColumnExists}`);
      console.log(`Permissions table has action column: ${actionColumnExists}`);
      
      // Count permissions
      const permissionsCount = await queryRunner.query("SELECT COUNT(*) as count FROM permissions");
      console.log(`Number of permissions in database: ${permissionsCount[0].count}`);
    }
    
    // Check if roles table exists with proper structure
    const rolesTableExists = await queryRunner.hasTable('roles');
    console.log(`Roles table exists: ${rolesTableExists}`);
    
    if (rolesTableExists) {
      // Check columns in roles table
      const rolesColumns = await queryRunner.query("PRAGMA table_info(roles)");
      const rolesColumnNames = rolesColumns.map((col: any) => col.name);
      
      console.log("Roles table columns:", rolesColumnNames.join(', '));
      
      // Count roles
      const rolesCount = await queryRunner.query("SELECT COUNT(*) as count FROM roles");
      console.log(`Number of roles in database: ${rolesCount[0].count}`);
      
      // List roles
      const roles = await queryRunner.query("SELECT * FROM roles");
      console.log("Roles:", roles);
    }

    await queryRunner.release();

  } catch (error) {
    console.error('Error during migration:', error);
  } finally {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('Data source has been closed.');
    }
  }
}

// Run the migration
runAllMigrations().catch(error => console.error('Unhandled error:', error)); 