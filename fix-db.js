/**
 * Fix Permissions Table Schema
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Path to database
const dbPath = path.resolve(__dirname, 'src/db.sqlite');
console.log(`Using database at: ${dbPath}`);

// Check database exists
if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found at: ${dbPath}`);
  process.exit(1);
}

// Open database
const db = new sqlite3.Database(dbPath);
console.log('Database opened successfully');

// Simple fix in sequence
db.serialize(() => {
  // 1. Add resource_name column
  db.run("ALTER TABLE permissions ADD COLUMN resource_name TEXT", function(err) {
    console.log(err ? `resource_name column exists: ${err.message}` : 'Added resource_name column');
    
    // 2. Add action column
    db.run("ALTER TABLE permissions ADD COLUMN action TEXT", function(err) {
      console.log(err ? `action column exists: ${err.message}` : 'Added action column');
      
      // 3. Update resource_name from name field
      db.run(`
        UPDATE permissions 
        SET resource_name = SUBSTR(name, 1, INSTR(name, ':') - 1) 
        WHERE INSTR(name, ':') > 0
      `, function(err) {
        console.log(err ? `Error updating resource_name: ${err.message}` : 'Updated resource_name values');
        
        // 4. Update action from name field
        db.run(`
          UPDATE permissions 
          SET action = SUBSTR(name, INSTR(name, ':') + 1) 
          WHERE INSTR(name, ':') > 0
        `, function(err) {
          console.log(err ? `Error updating action: ${err.message}` : 'Updated action values');
          
          // 5. Create indexes
          db.run("CREATE INDEX IF NOT EXISTS idx_permissions_resource_name ON permissions (resource_name)", function(err) {
            console.log(err ? `Error creating resource_name index: ${err.message}` : 'Created resource_name index');
            
            db.run("CREATE INDEX IF NOT EXISTS idx_permissions_action ON permissions (action)", function(err) {
              console.log(err ? `Error creating action index: ${err.message}` : 'Created action index');
              
              // 6. Show updated schema
              db.all("PRAGMA table_info(permissions)", function(err, columns) {
                if (err) {
                  console.error(`Error getting schema: ${err.message}`);
                } else {
                  console.log('\nPermissions table columns:');
                  columns.forEach(col => console.log(`- ${col.name} (${col.type})`));
                }
                
                // 7. Show sample data
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
                    console.log(err ? `Error closing database: ${err.message}` : 'Database closed. Schema fix completed.');
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}); 