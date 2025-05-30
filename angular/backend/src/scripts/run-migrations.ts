import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import * as path from 'path';
import { FixSQLiteCompositePrimaryKeys1742536989657 } from '../migrations/1742536989657-FixSQLiteCompositePrimaryKeys';

// Load environment variables
config();

async function runMigration() {
  console.log('Starting database migration for SQLite composite key fixes...');
  
  const configService = new ConfigService();
  const isDevelopment = configService.get('NODE_ENV') !== 'production';
  
  // Create a data source
  const dataSource = new DataSource({
    type: 'sqlite',
    database: configService.get('DATABASE_FILE', 'db.sqlite'),
    entities: [path.join(__dirname, '../modules/**/entities/*.entity{.ts,.js}')],
    migrations: [path.join(__dirname, '../migrations/*{.ts,.js}')],
    migrationsTableName: 'migrations_history',
    synchronize: false,
    logging: true,
  });

  try {
    // Initialize the data source
    await dataSource.initialize();
    console.log('Database connection established');
    
    // Create migration instance
    const migration = new FixSQLiteCompositePrimaryKeys1742536989657();
    
    // Run the migration
    console.log('Running Fix SQLite Composite Primary Keys migration...');
    await migration.up(dataSource.createQueryRunner());
    
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Error running migration:', error);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('Database connection closed');
    }
  }
}

// Run the migration
runMigration().catch(console.error); 