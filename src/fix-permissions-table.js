const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Get the database path
const dbPath = path.join(__dirname, 'database', 'database.sqlite');

// Make sure the database exists
if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found: ${dbPath}`);
  process.exit(1);
}

console.log(`Opening database at: ${dbPath}`);
const db = new sqlite3.Database(dbPath);

// Run a query and return a promise
function run(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) {
        console.error(`Error running query: ${query}`, err);
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
}

// Get all rows from a query
function all(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        console.error(`Error running query: ${query}`, err);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Get a single row from a query
function get(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        console.error(`Error running query: ${query}`, err);
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Main function to fix the permissions table
async function fixPermissionsTable() {
  try {
    console.log('Starting permissions table fix...');

    // Start a transaction
    await run('BEGIN TRANSACTION');

    // Check if permissions table exists
    const permissionsTable = await get("SELECT name FROM sqlite_master WHERE type='table' AND name='permissions'");
    
    if (!permissionsTable) {
      console.log('Permissions table does not exist, creating it...');
      
      // Create the permissions table
      await run(`
        CREATE TABLE IF NOT EXISTS "permissions" (
          "id" INTEGER PRIMARY KEY AUTOINCREMENT,
          "name" VARCHAR(100) UNIQUE,
          "description" TEXT,
          "resource_name" VARCHAR(50),
          "action" VARCHAR(50),
          "action_id" INTEGER,
          "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
          "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      console.log('Permissions table created successfully.');
    } else {
      console.log('Permissions table exists, checking columns...');
      
      // Get columns in permissions table
      const columns = await all("PRAGMA table_info(permissions)");
      const columnNames = columns.map(col => col.name);
      
      console.log(`Existing columns: ${columnNames.join(', ')}`);
      
      // Check for resource_name column
      if (!columnNames.includes('resource_name')) {
        console.log('Adding resource_name column...');
        await run(`ALTER TABLE "permissions" ADD COLUMN "resource_name" VARCHAR(50)`);
        
        // Update resource_name from name field
        await run(`
          UPDATE "permissions"
          SET "resource_name" = SUBSTR("name", 1, INSTR("name", ':') - 1)
          WHERE INSTR("name", ':') > 0
        `);
        
        console.log('resource_name column added and populated.');
      }
      
      // Check for action column
      if (!columnNames.includes('action')) {
        console.log('Adding action column...');
        await run(`ALTER TABLE "permissions" ADD COLUMN "action" VARCHAR(50)`);
        
        // Update action from name field
        await run(`
          UPDATE "permissions"
          SET "action" = SUBSTR("name", INSTR("name", ':') + 1)
          WHERE INSTR("name", ':') > 0
        `);
        
        console.log('action column added and populated.');
      }
    }
    
    // Create indexes
    console.log('Creating indexes...');
    await run(`CREATE INDEX IF NOT EXISTS "idx_permissions_name" ON "permissions" ("name")`);
    await run(`CREATE INDEX IF NOT EXISTS "idx_permissions_resource_name" ON "permissions" ("resource_name")`);
    await run(`CREATE INDEX IF NOT EXISTS "idx_permissions_action" ON "permissions" ("action")`);
    
    // Commit the transaction
    await run('COMMIT');
    console.log('Transaction committed successfully.');
    
    // Verify the changes
    const permissions = await all("SELECT * FROM permissions LIMIT 5");
    console.log('\nSample permissions:');
    permissions.forEach(perm => {
      console.log(`- ${perm.name} | Resource: ${perm.resource_name} | Action: ${perm.action}`);
    });
    
    console.log('\nPermissions table fix completed successfully!');
  } catch (error) {
    console.error('Error fixing permissions table:', error);
    
    // Roll back the transaction on error
    try {
      await run('ROLLBACK');
      console.log('Transaction rolled back due to error.');
    } catch (rollbackError) {
      console.error('Error rolling back transaction:', rollbackError);
    }
  } finally {
    // Close the database connection
    db.close(err => {
      if (err) {
        console.error('Error closing database connection:', err);
      } else {
        console.log('Database connection closed.');
      }
    });
  }
}

// Run the fix
fixPermissionsTable(); 