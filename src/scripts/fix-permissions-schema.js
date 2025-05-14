/**
 * Fix Permissions Schema Script
 * 
 * This script directly modifies the SQLite database to fix the permissions table schema
 * by adding missing columns needed by the Permission entity.
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Get the database path - adjust this path if needed
const dbPath = path.resolve(__dirname, '../db.sqlite');
console.log(`Using database at: ${dbPath}`);

// Make sure the database exists
if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found: ${dbPath}`);
  process.exit(1);
}

console.log(`Opening database at: ${dbPath}`);
const db = new sqlite3.Database(dbPath);

console.log('Starting permissions schema fix...');

// Execute fix in sequence
db.serialize(() => {
  // Start transaction
  db.run('BEGIN TRANSACTION');
  
  // 1. Check if the permissions table exists
  console.log('1. Checking if permissions table exists');
  db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='permissions'`, (err, row) => {
    if (err) {
      console.error('Error checking for permissions table:', err.message);
      db.run('ROLLBACK');
      process.exit(1);
    }
    
    if (!row) {
      console.error('Permissions table does not exist!');
      db.run('ROLLBACK');
      process.exit(1);
    }
    
    console.log('Permissions table exists, proceeding with modifications...');
    
    // 2. Get current columns
    db.all(`PRAGMA table_info(permissions)`, (err, columns) => {
      if (err) {
        console.error('Error getting table info:', err.message);
        db.run('ROLLBACK');
        process.exit(1);
      }
      
      const columnNames = columns.map(col => col.name);
      console.log('Current columns:', columnNames.join(', '));
      
      // 3. Add resource_name column if it doesn't exist
      if (!columnNames.includes('resource_name')) {
        console.log('Adding resource_name column...');
        db.run(`ALTER TABLE permissions ADD COLUMN resource_name VARCHAR(50)`, (err) => {
          if (err) {
            console.error('Error adding resource_name column:', err.message);
          } else {
            console.log('resource_name column added successfully');
          }
        });
      } else {
        console.log('resource_name column already exists');
      }
      
      // 4. Add action column if it doesn't exist
      if (!columnNames.includes('action')) {
        console.log('Adding action column...');
        db.run(`ALTER TABLE permissions ADD COLUMN action VARCHAR(50)`, (err) => {
          if (err) {
            console.error('Error adding action column:', err.message);
          } else {
            console.log('action column added successfully');
          }
        });
      } else {
        console.log('action column already exists');
      }
      
      // 5. Update the resource_name and action columns by parsing the name field
      console.log('Updating resource_name from name field...');
      db.run(`
        UPDATE permissions
        SET resource_name = SUBSTR(name, 1, INSTR(name, ':') - 1)
        WHERE resource_name IS NULL AND INSTR(name, ':') > 0
      `, (err) => {
        if (err) {
          console.error('Error updating resource_name:', err.message);
        } else {
          console.log('resource_name values updated successfully');
        }
      });
      
      console.log('Updating action from name field...');
      db.run(`
        UPDATE permissions
        SET action = SUBSTR(name, INSTR(name, ':') + 1)
        WHERE action IS NULL AND INSTR(name, ':') > 0
      `, (err) => {
        if (err) {
          console.error('Error updating action:', err.message);
        } else {
          console.log('action values updated successfully');
        }
      });
      
      // 6. Create indexes for faster queries
      console.log('Creating indexes...');
      db.run(`CREATE INDEX IF NOT EXISTS idx_permissions_resource_name ON permissions (resource_name)`, (err) => {
        if (err) {
          console.error('Error creating resource_name index:', err.message);
        } else {
          console.log('resource_name index created successfully');
        }
      });
      
      db.run(`CREATE INDEX IF NOT EXISTS idx_permissions_action ON permissions (action)`, (err) => {
        if (err) {
          console.error('Error creating action index:', err.message);
        } else {
          console.log('action index created successfully');
        }
      });
      
      // 7. Commit the transaction
      db.run('COMMIT', (err) => {
        if (err) {
          console.error('Error committing transaction:', err.message);
          db.run('ROLLBACK');
        } else {
          console.log('Transaction committed successfully');
          
          // 8. Verify the changes
          db.all(`PRAGMA table_info(permissions)`, (err, updatedColumns) => {
            if (err) {
              console.error('Error getting updated table info:', err.message);
            } else {
              const updatedColumnNames = updatedColumns.map(col => col.name);
              console.log('Updated columns:', updatedColumnNames.join(', '));
              
              // 9. Show a sample of the updated permissions
              db.all(`SELECT id, name, resource_name, action FROM permissions LIMIT 5`, (err, rows) => {
                if (err) {
                  console.error('Error getting sample permissions:', err.message);
                } else {
                  console.log('\nSample permissions:');
                  rows.forEach(row => {
                    console.log(`- ID: ${row.id}, Name: ${row.name}, Resource: ${row.resource_name}, Action: ${row.action}`);
                  });
                }
                
                // 10. Close the database connection
                db.close((err) => {
                  if (err) {
                    console.error('Error closing database:', err.message);
                  } else {
                    console.log('\nDatabase connection closed. Schema fix completed successfully.');
                  }
                });
              });
            }
          });
        }
      });
    });
  });
}); 