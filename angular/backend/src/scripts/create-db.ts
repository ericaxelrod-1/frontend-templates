import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';

// Load environment variables
config();

/**
 * Script to directly create SQLite database tables for dynamic access control
 * This bypasses TypeORM migrations for development purposes
 */
async function createDatabase() {
  console.log('Starting database creation script...');

  // Determine the database path from environment or use default
  const dbPath =
    process.env.DATABASE_PATH || './sqlite-db/task-management.sqlite';

  // Ensure the directory exists
  const directory = path.dirname(dbPath);
  if (!fs.existsSync(directory)) {
    console.log(`Creating directory: ${directory}`);
    fs.mkdirSync(directory, { recursive: true });
  }

  // Check if database file already exists
  if (fs.existsSync(dbPath)) {
    console.log(`Database file already exists at: ${dbPath}`);
    console.log(
      'To recreate the database, delete the file and run this script again.',
    );
    return;
  }

  try {
    // Create empty file to ensure path is valid
    fs.writeFileSync(dbPath, '');
    console.log(`Created empty database file at: ${dbPath}`);

    // Initialize connection to create schema
    const dataSource = new DataSource({
      type: 'sqlite',
      database: dbPath,
      entities: ['dist/**/*.entity{.ts,.js}'],
      synchronize: true,
      logging: true,
    });

    console.log('Initializing database connection...');
    await dataSource.initialize();
    console.log('Database connection initialized.');

    console.log('Database schema created successfully.');
    await dataSource.destroy();

    console.log(
      'Database creation completed. You can now run the following commands:',
    );
    console.log(
      '- npm run db:seed              # Seed the database with initial data',
    );
    console.log('- npm run db:seed:permissions  # Seed permissions data');
    console.log(
      '- npm run permissions:scan     # Scan for permissions in the codebase',
    );
  } catch (error) {
    console.error('Error creating database:', error);
    process.exit(1);
  }
}

// Run the script
createDatabase()
  .then(() => {
    console.log('Database creation script completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Database creation script failed:', error);
    process.exit(1);
  });
