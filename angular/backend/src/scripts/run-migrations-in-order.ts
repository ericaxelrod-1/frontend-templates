import { DataSource } from 'typeorm';
import { join } from 'path';
import dataSource from '../database/data-source';
import { Logger } from '@nestjs/common';

/**
 * This script runs migrations in a controlled order to ensure
 * database schema is properly set up with the IF NOT EXISTS modifications
 */
async function runMigrationsInOrder() {
  const logger = new Logger('MigrationRunner');
  logger.log('Starting controlled database migration...');

  try {
    // Connect to the database
    await dataSource.initialize();
    logger.log('Database connection established');

    // Run the migrations in a specific order
    // First run the SQLite-specific fix
    logger.log('Running SQLite Composite Primary Keys fix...');

    // Run the specific SQLite fix migration manually
    const migration = await import(
      '../migrations/1742536989657-FixSQLiteCompositePrimaryKeys'
    );
    const instance = new migration.FixSQLiteCompositePrimaryKeys1742536989657();
    await instance.up(dataSource.createQueryRunner());
    logger.log('SQLite fix migration completed');

    // Run base entity setup migrations with IF NOT EXISTS patterns
    logger.log('Running base entity creation migrations...');
    await dataSource.runMigrations({
      transaction: 'each',
    });

    logger.log('All migrations completed successfully');
  } catch (error) {
    logger.error(`Error during migration: ${error.message}`, error.stack);
    process.exit(1);
  } finally {
    // Close the connection
    if (dataSource.isInitialized) {
      await dataSource.destroy();
      logger.log('Database connection closed');
    }
  }
}

// Run the migration process
runMigrationsInOrder().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
