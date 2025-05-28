import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { join } from 'path';
import * as fs from 'fs';

const dbPath = join(__dirname, '..', '..', 'db.sqlite');

/**
 * Custom database preparation script for SQLite
 * This script directly creates tables if they don't exist, avoiding migration issues
 * It will drop and recreate specific tables to ensure their schema is correct.
 */
async function prepareDatabase() {
  console.log('Starting database preparation...');
  console.log(`Database path: ${dbPath}`);

  // Create a SQLite database connection
  const db = new sqlite3.Database(dbPath);

  // Promisify SQLite methods
  const run = promisify(db.run.bind(db));
  const get = promisify(db.get.bind(db));
  // const all = promisify(db.all.bind(db)); // all is not used

  try {
    // Run everything in a transaction
    await run('BEGIN TRANSACTION');

    // Manage migrations_history table (TypeORM uses a different one, usually 'migrations')
    const migrationsHistoryTableExists = await get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='migrations_history'`
    );

    if (!migrationsHistoryTableExists) {
      console.log('Creating migrations_history table (custom for this script)...');
      await run(`
        CREATE TABLE migrations_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp BIGINT NOT NULL,
          name TEXT NOT NULL
        )
      `);
    }

    // These are migrations this script assumes are foundational or handles directly by defining schema.
    // Recording them here is for this script's own tracking, might not affect TypeORM's view.
    const foundationalMigrationsToRecord = [
      { timestamp: 1658012345678, name: 'CreatePermissionEntities1658012345678' },
      // { timestamp: 1658012445678, name: 'SeedInitialPermissions1658012445678' }, // Seeding should happen via TypeORM migrations after schema is correct
      // { timestamp: 1742536989657, name: 'FixSQLiteCompositePrimaryKeys1742536989657' }
    ];

    for (const migration of foundationalMigrationsToRecord) {
      const exists = await get(
        `SELECT * FROM migrations_history WHERE name = ?`,
        migration.name
      );
      if (!exists) {
        console.log(`Recording foundational migration ${migration.name} in custom migrations_history...`);
        await run(
          `INSERT INTO migrations_history (timestamp, name) VALUES (?, ?)`,
          migration.timestamp,
          migration.name
        );
      }
    }

    // Define critical tables and their correct schemas
    // These will be dropped and recreated to ensure they are correct.
    const criticalTablesToRecreate = [
      {
        name: 'permissions',
        sql: `
          CREATE TABLE "permissions" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "resourceName" TEXT NOT NULL,
            "actionName" TEXT NOT NULL,
            "name" TEXT NOT NULL,
            "description" TEXT,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE("resourceName", "actionName")
          )
        `
      },
      {
        name: 'roles',
        sql: `
          CREATE TABLE "roles" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "name" TEXT NOT NULL UNIQUE,
            "description" TEXT,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      },
      {
        name: 'role_permissions', // Depends on roles and permissions
        sql: `
          CREATE TABLE "role_permissions" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "role_id" INTEGER NOT NULL,
            "permission_id" INTEGER NOT NULL,
            UNIQUE("role_id", "permission_id"),
            FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE,
            FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
          )
        `
      },
      // Add 'users' table definition as 'groups' depends on it for FOREIGN KEY
      {
        name: 'users', // Assuming a basic users table structure
        sql: `
          CREATE TABLE "users" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "username" TEXT NOT NULL UNIQUE,
            "password" TEXT NOT NULL,
            "email" TEXT UNIQUE,
            "isActive" INTEGER DEFAULT 1,
            "lastLogin" DATETIME,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      },
      {
        name: 'groups', // Depends on users
        sql: `
          CREATE TABLE "groups" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "name" TEXT NOT NULL UNIQUE,
            "description" TEXT,
            "ownerId" INTEGER,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE
          )
        `
      }
      // Add other critical tables here if needed
    ];

    // Drop and recreate critical tables
    // Order matters for foreign keys: drop dependent tables first, or create principal tables first.
    // For simplicity here, we drop then create in order. If complex dependencies, might need specific order.
    // To handle FKs correctly, usually easier to create all tables then add FKs, or ensure create order.
    // This simplified approach might need PRAGMA foreign_keys=OFF/ON if creation order is an issue.
    // However, since we are in a single transaction, SQLite might defer FK checks.

    for (const table of criticalTablesToRecreate) {
      const tableExists = await get(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        table.name
      );
      if (tableExists) {
        console.log(`Dropping existing table ${table.name} to ensure correct schema...`);
        await run(`DROP TABLE ${table.name}`);
      }
      console.log(`Creating table ${table.name} with correct schema...`);
      await run(table.sql);
    }
    
    // Commit the transaction
    await run('COMMIT');
    console.log('Database preparation completed successfully.');

  } catch (error) {
    // Rollback on error
    console.error('Error detected during database preparation, attempting rollback...');
    try {
      await run('ROLLBACK');
      console.log('Rollback successful.');
    } catch (rollbackError) {
      console.error('Rollback failed:', rollbackError);
    }
    console.error('Error preparing database:', error);
    process.exit(1);
  } finally {
    // Close the database connection
    db.close((closeErr) => {
      if (closeErr) {
        console.error('Error closing database:', closeErr.message);
      } else {
        console.log('Database connection closed.');
      }
    });
  }
}

// Run the preparation
prepareDatabase().catch(err => {
  // This catch might be redundant if prepareDatabase handles its own errors and exits
  console.error('Unhandled error during database preparation script execution:', err);
  process.exit(1);
}); 