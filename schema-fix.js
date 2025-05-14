/**
 * Simple Schema Fix Script
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Database path
const dbPath = path.resolve(__dirname, 'db.sqlite');
console.log(`Using database at: ${dbPath}`);

// Check database exists
if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found at: ${dbPath}`);
  process.exit(1);
}

// Open database
const db = new sqlite3.Database(dbPath);
console.log('Database opened successfully');

// Execute all fixes in a transaction
db.serialize(() => {
  db.run('BEGIN TRANSACTION');
  
  // Add resource_name column if it doesn't exist
  db.run("ALTER TABLE permissions ADD COLUMN resource_name TEXT", function(err) {
    if (err) {
      console.log(`Note: ${err.message}`);
    } else {
      console.log('Added resource_name column');
    }
  });
  
  // Add action column if it doesn't exist
  db.run("ALTER TABLE permissions ADD COLUMN action TEXT", function(err) {
    if (err) {
      console.log(`Note: ${err.message}`);
    } else {
      console.log('Added action column');
    }
  });
  
  // Extract resource_name from name field
  db.run(`
    UPDATE permissions
    SET resource_name = SUBSTR(name, 1, INSTR(name, ':') - 1)
    WHERE resource_name IS NULL AND INSTR(name, ':') > 0
  `, function(err) {
    if (err) {
      console.error(`Error updating resource_name: ${err.message}`);
    } else {
      console.log(`Updated ${this.changes} resource_name values`);
    }
  });
  
  // Extract action from name field
  db.run(`
    UPDATE permissions
    SET action = SUBSTR(name, INSTR(name, ':') + 1)
    WHERE action IS NULL AND INSTR(name, ':') > 0
  `, function(err) {
    if (err) {
      console.error(`Error updating action: ${err.message}`);
    } else {
      console.log(`Updated ${this.changes} action values`);
    }
  });
  
  // Create indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_permissions_resource_name ON permissions (resource_name)", function(err) {
    if (err) {
      console.error(`Error creating index: ${err.message}`);
    } else {
      console.log('Created resource_name index');
    }
  });
  
  db.run("CREATE INDEX IF NOT EXISTS idx_permissions_action ON permissions (action)", function(err) {
    if (err) {
      console.error(`Error creating index: ${err.message}`);
    } else {
      console.log('Created action index');
    }
  });
  
  // Commit transaction
  db.run('COMMIT', function(err) {
    if (err) {
      console.error(`Error committing transaction: ${err.message}`);
      db.run('ROLLBACK');
    } else {
      console.log('Transaction committed successfully');
      
      // Check results
      db.all("PRAGMA table_info(permissions)", function(err, columns) {
        if (err) {
          console.error(`Error getting schema: ${err.message}`);
        } else {
          console.log('\nPermissions table columns:');
          columns.forEach(col => console.log(`- ${col.name} (${col.type})`));
        }
        
        // Show sample data
        db.all("SELECT id, name, resource_name, action FROM permissions LIMIT 5", function(err, rows) {
          if (err) {
            console.error(`Error getting sample data: ${err.message}`);
          } else {
            console.log('\nSample permissions:');
            if (rows.length === 0) {
              console.log('No permissions found');
            } else {
              rows.forEach(row => {
                console.log(`- ID: ${row.id}, Name: ${row.name}, Resource: ${row.resource_name || 'NULL'}, Action: ${row.action || 'NULL'}`);
              });
            }
          }
          
          // Close database
          db.close(function(err) {
            if (err) {
              console.error(`Error closing database: ${err.message}`);
            } else {
              console.log('Database closed. Schema fix completed.');
            }
          });
        });
      });
    }
  });
}); 