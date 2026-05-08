import { DataSource } from 'typeorm';
import { config } from 'dotenv';

// Load environment variables
config();

/**
 * This script runs a direct migration to fix the permissions table schema.
 */
async function runAllMigrations() {
  console.log('Starting permissions schema verification...');
  console.log(
    'This will check if the permissions table has the correct structure and relationships.',
  );

  const dataSource = new DataSource({
    type: 'sqlite',
    database: process.env.DATABASE_PATH || './src/database/database.sqlite',
    synchronize: false,
    logging: true,
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [],
    subscribers: [],
  });

  try {
    await dataSource.initialize();
    console.log('Data source has been initialized!');

    console.log('Schema verification started...');

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
      const columns = await queryRunner.query('PRAGMA table_info(permissions)');
      const columnNames = columns.map((col: any) => col.name);

      console.log('Permissions table columns:', columnNames.join(', '));

      const resourceNameColumnExists = columnNames.includes('resource_name');
      const actionColumnExists = columnNames.includes('action');

      console.log(
        `Permissions table has resource_name column: ${resourceNameColumnExists}`,
      );
      console.log(`Permissions table has action column: ${actionColumnExists}`);

      // Count permissions
      const permissionsCount = await queryRunner.query(
        'SELECT COUNT(*) as count FROM permissions',
      );
      console.log(
        `Number of permissions in database: ${permissionsCount[0].count}`,
      );

      // Check resource_name and action columns have values
      const emptyResourceNameCount = await queryRunner.query(
        'SELECT COUNT(*) as count FROM permissions WHERE resource_name IS NULL',
      );
      const emptyActionCount = await queryRunner.query(
        'SELECT COUNT(*) as count FROM permissions WHERE action IS NULL',
      );

      console.log(
        `Permissions with empty resource_name: ${emptyResourceNameCount[0].count}`,
      );
      console.log(
        `Permissions with empty action: ${emptyActionCount[0].count}`,
      );
    }

    // Check foreign keys in tables referencing permissions

    // Check user_permission table foreign keys
    if (await queryRunner.hasTable('user_permission')) {
      const userPermissionForeignKeys = await queryRunner.query(
        `PRAGMA foreign_key_list(user_permission)`,
      );

      console.log('User permission foreign keys:');
      console.log(userPermissionForeignKeys);
    }

    // Check role_permissions table foreign keys
    if (await queryRunner.hasTable('role_permissions')) {
      const rolePermissionsForeignKeys = await queryRunner.query(
        `PRAGMA foreign_key_list(role_permissions)`,
      );

      console.log('Role permissions foreign keys:');
      console.log(rolePermissionsForeignKeys);
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
runAllMigrations().catch((error) => console.error('Unhandled error:', error));
