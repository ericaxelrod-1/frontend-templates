import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { AddResourceNameActionColumns1742538123123 } from '../migrations/1742538123123-AddResourceNameActionColumns';

// Load environment variables
config();

/**
 * This script runs the schema fix migration that adds missing columns to permissions table
 */
async function runSchemaFix() {
  console.log('Starting schema fix migration...');
  console.log('This will add resource_name and action columns to the permissions table');

  const dataSource = new DataSource({
    type: 'sqlite',
    database: process.env.DATABASE_PATH || '../database/database.sqlite',
    synchronize: false,
    logging: true,
    migrations: [
      AddResourceNameActionColumns1742538123123
    ],
  });

  try {
    await dataSource.initialize();
    console.log('Data source has been initialized!');

    // Run the migration
    console.log('Running migration...');
    await dataSource.runMigrations({ transaction: 'all' });

    console.log('Migration completed successfully!');
    
    // Verify the changes by querying the permissions table
    const permissions = await dataSource.query('SELECT * FROM permissions LIMIT 5');
    console.log('\nSample permissions after migration:');
    permissions.forEach(perm => {
      console.log(`- ${perm.name} (${perm.resource_name}:${perm.action})`);
    });

    // Close the connection
    await dataSource.destroy();
    console.log('Data source has been closed.');
  } catch (error) {
    console.error('Error during migration:', error);
    process.exit(1);
  }
}

// Run the migration
runSchemaFix().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 