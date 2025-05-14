/**
 * Quick Fix for Permissions Table Schema
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Direct path to the database in src directory
const dbPath = path.resolve(__dirname, 'db.sqlite');
console.log(`Using database at: ${dbPath}`);

// Check database exists
if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found at: ${dbPath}`);
  process.exit(1);
}

// Open database connection
const db = new sqlite3.Database(dbPath);
console.log('Database opened successfully');

// Run fixes sequentially
db.serialize(() => {
  // Simple direct approach - add columns
  db.run("ALTER TABLE permissions ADD COLUMN resource_name TEXT", (err) => {
    console.log(err ? `resource_name column exists: ${err.message}` : 'Added resource_name column');
    
    // Update resource_name from name field
    db.run(`
      UPDATE permissions 
      SET resource_name = SUBSTR(name, 1, INSTR(name, ':') - 1) 
      WHERE INSTR(name, ':') > 0
    `, (err) => {
      console.log(err ? `Error updating resource_name: ${err.message}` : 'Updated resource_name values');
      
      // Add action column
      db.run("ALTER TABLE permissions ADD COLUMN action TEXT", (err) => {
        console.log(err ? `action column exists: ${err.message}` : 'Added action column');
        
        // Update action from name field
        db.run(`
          UPDATE permissions 
          SET action = SUBSTR(name, INSTR(name, ':') + 1) 
          WHERE INSTR(name, ':') > 0
        `, (err) => {
          console.log(err ? `Error updating action: ${err.message}` : 'Updated action values');
          
          // Create indexes
          db.run("CREATE INDEX IF NOT EXISTS idx_permissions_resource_name ON permissions (resource_name)", (err) => {
            console.log(err ? `Error creating index: ${err.message}` : 'Created resource_name index');
            
            db.run("CREATE INDEX IF NOT EXISTS idx_permissions_action ON permissions (action)", (err) => {
              console.log(err ? `Error creating index: ${err.message}` : 'Created action index');
              
              // Check result
              db.all("PRAGMA table_info(permissions)", (err, columns) => {
                if (err) {
                  console.error(`Error getting table info: ${err.message}`);
                } else {
                  console.log('Updated permissions table columns:');
                  columns.forEach(col => console.log(`- ${col.name} (${col.type})`));
                }
                
                // Show sample data
                db.all("SELECT id, name, resource_name, action FROM permissions LIMIT 3", (err, rows) => {
                  if (err) {
                    console.error(`Error getting sample data: ${err.message}`);
                  } else {
                    console.log('\nSample permissions:');
                    rows.forEach(row => console.log(`- ${row.id}: ${row.name} (${row.resource_name}:${row.action})`));
                  }
                  
                  // Close connection
                  db.close();
                  console.log('Database connection closed');
                });
              });
            });
          });
        });
      });
    });
  });
}); 