import { DataSource } from 'typeorm';
import dataSource from './data-source';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Script to synchronize database schema with entity definitions
 * This is useful during development but should not be used in production
 */
async function syncSchema() {
  try {
    console.log('Initializing database connection...');
    const connection = await dataSource.initialize();

    console.log('Database connection established');

    // Check if we need to run SQLite-specific preparations
    if (dataSource.options.type === 'sqlite') {
      console.log(
        'SQLite detected, performing SQLite-specific preparations...',
      );

      // Create the tables directly with SQLite-compatible SQL
      console.log('Creating permission-related tables...');

      // Create permissions table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS "permissions" (
          "id" TEXT PRIMARY KEY,
          "resourceName" TEXT NOT NULL,
          "actionName" TEXT NOT NULL,
          "name" TEXT NOT NULL,
          "description" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT (datetime('now')),
          "updatedAt" DATETIME NOT NULL DEFAULT (datetime('now')),
          UNIQUE("resourceName", "actionName")
        )
      `);

      // Create ui_components table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS "ui_components" (
          "id" TEXT PRIMARY KEY,
          "selector" TEXT NOT NULL UNIQUE,
          "description" TEXT,
          "filePath" TEXT,
          "overridePermissions" INTEGER NOT NULL DEFAULT 0,
          "lastSynced" DATETIME,
          "createdAt" DATETIME NOT NULL DEFAULT (datetime('now')),
          "updatedAt" DATETIME NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Create frontend_routes table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS "frontend_routes" (
          "id" TEXT PRIMARY KEY,
          "path" TEXT NOT NULL UNIQUE,
          "description" TEXT,
          "component" TEXT,
          "overridePermissions" INTEGER NOT NULL DEFAULT 0,
          "lastSynced" DATETIME,
          "createdAt" DATETIME NOT NULL DEFAULT (datetime('now')),
          "updatedAt" DATETIME NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Create api_endpoints table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS "api_endpoints" (
          "id" TEXT PRIMARY KEY,
          "method" TEXT NOT NULL,
          "path" TEXT NOT NULL,
          "description" TEXT,
          "controllerName" TEXT,
          "handlerName" TEXT,
          "overridePermissions" INTEGER NOT NULL DEFAULT 0,
          "lastSynced" DATETIME,
          "createdAt" DATETIME NOT NULL DEFAULT (datetime('now')),
          "updatedAt" DATETIME NOT NULL DEFAULT (datetime('now')),
          UNIQUE("method", "path")
        )
      `);

      // Create ui_component_permissions junction table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS "ui_component_permissions" (
          "component_id" TEXT NOT NULL,
          "permission_id" TEXT NOT NULL,
          PRIMARY KEY ("component_id", "permission_id"),
          CONSTRAINT "FK_ui_component_permissions_component" FOREIGN KEY ("component_id") REFERENCES "ui_components"("id") ON DELETE CASCADE,
          CONSTRAINT "FK_ui_component_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
        )
      `);

      // Create frontend_route_permissions junction table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS "frontend_route_permissions" (
          "route_id" TEXT NOT NULL,
          "permission_id" TEXT NOT NULL,
          PRIMARY KEY ("route_id", "permission_id"),
          CONSTRAINT "FK_frontend_route_permissions_route" FOREIGN KEY ("route_id") REFERENCES "frontend_routes"("id") ON DELETE CASCADE,
          CONSTRAINT "FK_frontend_route_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
        )
      `);

      // Create api_endpoint_permissions junction table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS "api_endpoint_permissions" (
          "endpoint_id" TEXT NOT NULL,
          "permission_id" TEXT NOT NULL,
          PRIMARY KEY ("endpoint_id", "permission_id"),
          CONSTRAINT "FK_api_endpoint_permissions_endpoint" FOREIGN KEY ("endpoint_id") REFERENCES "api_endpoints"("id") ON DELETE CASCADE,
          CONSTRAINT "FK_api_endpoint_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
        )
      `);

      // Create cache_sync_status table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS "cache_sync_status" (
          "id" TEXT PRIMARY KEY,
          "entityType" TEXT NOT NULL,
          "lastSyncTime" DATETIME NOT NULL,
          "syncStats" TEXT,
          "error" TEXT,
          "syncSuccessful" INTEGER NOT NULL DEFAULT 1,
          "createdAt" DATETIME NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Create initial records for cache sync status
      const entityTypes = ['component', 'route', 'endpoint', 'permission'];
      const now = new Date().toISOString();

      for (const entityType of entityTypes) {
        await connection.query(`
          INSERT OR IGNORE INTO "cache_sync_status" 
          ("id", "entityType", "lastSyncTime", "syncStats", "syncSuccessful") 
          VALUES (
              '${entityType}', 
              '${entityType}', 
              '${now}', 
              '{"added":0,"updated":0,"deleted":0,"unchanged":0,"errors":0}', 
              1
          )
        `);
      }

      console.log('Tables created successfully');
    } else {
      // For non-SQLite databases, use TypeORM's schema synchronization
      console.log('Synchronizing schema using TypeORM...');
      await connection.synchronize(false);
    }

    console.log('Schema synchronization completed successfully');

    // Create a backup of the database file if using SQLite
    if (
      dataSource.options.type === 'sqlite' &&
      typeof dataSource.options.database === 'string'
    ) {
      const dbFile = dataSource.options.database;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = `${dbFile}.${timestamp}.backup`;

      // Create backups directory if it doesn't exist
      const backupDir = path.join(path.dirname(dbFile), 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const targetBackupPath = path.join(backupDir, path.basename(backupFile));

      // Copy database file to backup
      if (fs.existsSync(dbFile)) {
        fs.copyFileSync(dbFile, targetBackupPath);
        console.log(`Database backup created at: ${targetBackupPath}`);
      }
    }

    // Close the connection
    await connection.destroy();

    console.log('Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error during schema synchronization:', error);
    process.exit(1);
  }
}

// Run the synchronization
syncSchema();
