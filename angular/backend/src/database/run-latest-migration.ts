import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { FixPermissionsTableColumns1742536989660 } from '../migrations/1742536989660-FixPermissionsTableColumns';

// Load environment variables
config();

async function runMigration() {
  console.log('Starting migration to fix permissions table columns...');

  const dataSource = new DataSource({
    type: 'sqlite',
    database: process.env.DATABASE_PATH || './src/database/database.sqlite',
    synchronize: false,
    logging: true,
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [FixPermissionsTableColumns1742536989660],
    subscribers: [],
  });

  try {
    await dataSource.initialize();
    console.log('Data source has been initialized!');

    // Run our specific migration even if TypeORM doesn't think it needs to run
    const migration = new FixPermissionsTableColumns1742536989660();
    console.log(`Running migration: ${migration.name}`);
    await migration.up(dataSource.createQueryRunner());
    console.log('Migration completed successfully!');

  } catch (error) {
    console.error('Error during migration:', error);
  } finally {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('Data source has been closed.');
    }
  }
}

runMigration().catch(error => console.error('Unhandled error:', error)); 