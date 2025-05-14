/**
 * Simple Fix for Permissions Table Schema
 * 
 * This script adds missing columns to the permissions table
 * and updates them by parsing the existing name field.
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Direct path to the database in the current directory
const dbPath = path.resolve(__dirname, 'src/db.sqlite');
console.log(`Using database at: ${dbPath}`);

// Make sure the database exists
if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found: ${dbPath}`);
  process.exit(1);
}

console.log(`Opening database at: ${dbPath}`);
const db = new sqlite3.Database(dbPath);

console.log('Starting permissions schema fix...');

// Execute each step with proper error handling
db.serialize(() => {
  console.log('Adding missing columns...');
  
  // Add columns - these will fail silently if columns already exist
  db.run("ALTER TABLE permissions ADD COLUMN resource_name TEXT", function(err) {
    if (err) {
      console.log('Note: resource_name column already exists or other error:', err.message);
    } else {
      console.log('Added resource_name column');
    }
  });

  db.run("ALTER TABLE permissions ADD COLUMN action TEXT", function(err) {
    if (err) {
      console.log('Note: action column already exists or other error:', err.message);
    } else {
      console.log('Added action column');
    }
  });

  // Update columns with data parsed from name field
  console.log('Updating columns with data from name field...');
  db.run(`
    UPDATE permissions
    SET resource_name = SUBSTR(name, 1, INSTR(name, ':') - 1)
    WHERE resource_name IS NULL AND INSTR(name, ':') > 0
  `, function(err) {
    if (err) {
      console.error('Error updating resource_name:', err.message);
    } else {
      console.log(`Updated ${this.changes} resource_name values`);
    }
  });

  db.run(`
    UPDATE permissions
    SET action = SUBSTR(name, INSTR(name, ':') + 1)
    WHERE action IS NULL AND INSTR(name, ':') > 0
  `, function(err) {
    if (err) {
      console.error('Error updating action:', err.message);
    } else {
      console.log(`Updated ${this.changes} action values`);
    }
  });

  // Create indexes for faster queries
  console.log('Creating indexes...');
  db.run("CREATE INDEX IF NOT EXISTS idx_permissions_resource_name ON permissions (resource_name)", function(err) {
    if (err) {
      console.error('Error creating resource_name index:', err.message);
    } else {
      console.log('Created resource_name index');
    }
  });

  db.run("CREATE INDEX IF NOT EXISTS idx_permissions_action ON permissions (action)", function(err) {
    if (err) {
      console.error('Error creating action index:', err.message);
    } else {
      console.log('Created action index');
    }
  });

  // Show the updated schema and sample data
  db.all("PRAGMA table_info(permissions)", function(err, columns) {
    if (err) {
      console.error('Error getting table schema:', err.message);
    } else {
      console.log('\nUpdated permissions table columns:');
      columns.forEach(col => {
        console.log(`- ${col.name} (${col.type}${col.notnull ? ', NOT NULL' : ''}${col.pk ? ', PRIMARY KEY' : ''})`);
      });

      // Show sample data
      db.all("SELECT id, name, resource_name, action FROM permissions LIMIT 5", function(err, rows) {
        if (err) {
          console.error('Error fetching sample data:', err.message);
        } else {
          console.log('\nSample permissions data:');
          if (rows.length === 0) {
            console.log('No permissions found in database.');
          } else {
            rows.forEach(row => {
              console.log(`- ID: ${row.id}, Name: ${row.name}, Resource: ${row.resource_name || 'NULL'}, Action: ${row.action || 'NULL'}`);
            });
          }
        }
        
        // Close database connection
        db.close(function(err) {
          if (err) {
            console.error('Error closing database:', err.message);
          } else {
            console.log('\nDatabase connection closed. Schema fix completed successfully.');
          }
        });
      });
    }
  });
}); 