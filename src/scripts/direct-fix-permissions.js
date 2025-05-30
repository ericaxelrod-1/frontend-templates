/**
 * Direct Fix Permissions Script
 * 
 * This script directly adds missing columns to the permissions table
 * and populates them by parsing the existing name field.
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Try multiple possible locations for the database
const possiblePaths = [
  path.resolve(__dirname, '../db.sqlite'),
  path.resolve(__dirname, '../database/database.sqlite'),
  path.resolve(__dirname, '../database/db.sqlite'),
  path.resolve(__dirname, '../../db.sqlite')
];

let dbPath = null;
for (const potentialPath of possiblePaths) {
  if (fs.existsSync(potentialPath)) {
    dbPath = potentialPath;
    break;
  }
}

if (!dbPath) {
  console.error('Database file not found in any of the expected locations.');
  console.error('Looked in:', possiblePaths.join(', '));
  process.exit(1);
}

console.log(`Found database at: ${dbPath}`);
const db = new sqlite3.Database(dbPath);

console.log('Starting direct permissions schema fix...');

// Execute each step with proper error handling
db.serialize(() => {
  // Use a simple catch-all approach for adding columns
  // These ALTER TABLE statements will fail silently if columns already exist
  db.run("ALTER TABLE permissions ADD COLUMN resource_name TEXT", function(err) {
    if (err) {
      console.log('Note: resource_name column might already exist -', err.message);
    } else {
      console.log('Added resource_name column');
    }
  });

  db.run("ALTER TABLE permissions ADD COLUMN action TEXT", function(err) {
    if (err) {
      console.log('Note: action column might already exist -', err.message);
    } else {
      console.log('Added action column');
    }
  });

  // Update resource_name from name field (always runs even if we just added columns)
  db.run(`
    UPDATE permissions
    SET resource_name = SUBSTR(name, 1, INSTR(name, ':') - 1)
    WHERE resource_name IS NULL AND INSTR(name, ':') > 0
  `, function(err) {
    if (err) {
      console.error('Error updating resource_name values:', err.message);
    } else {
      console.log(`Updated ${this.changes} resource_name values`);
    }
  });

  // Update action from name field
  db.run(`
    UPDATE permissions
    SET action = SUBSTR(name, INSTR(name, ':') + 1)
    WHERE action IS NULL AND INSTR(name, ':') > 0
  `, function(err) {
    if (err) {
      console.error('Error updating action values:', err.message);
    } else {
      console.log(`Updated ${this.changes} action values`);
    }
  });

  // Create indexes for faster queries
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

  // Verify schema changes
  db.all("PRAGMA table_info(permissions)", function(err, columns) {
    if (err) {
      console.error('Error getting table schema:', err.message);
    } else {
      console.log('\nPermissions table columns:');
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
        db.close(err => {
          if (err) {
            console.error('Error closing database:', err.message);
          } else {
            console.log('\nDatabase connection closed. Schema fix completed.');
          }
        });
      });
    }
  });
}); 