const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Get the absolute database path
const dbPath = path.resolve(__dirname, 'database', 'database.sqlite');
console.log(`Using database at: ${dbPath}`);

// Make sure the database exists
if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found: ${dbPath}`);
  process.exit(1);
}

console.log(`Opening database at: ${dbPath}`);
const db = new sqlite3.Database(dbPath);

console.log('Starting final schema fix...');

// Execute fix in sequence
db.serialize(() => {
  // Start transaction
  db.run('BEGIN TRANSACTION');
  
  // 1. Check if resource_name column exists by directly executing ALTER TABLE
  console.log('1. Adding resource_name column if not exists');
  db.run(`
    SELECT 1 FROM pragma_table_info('permissions') WHERE name='resource_name'
  `, function(err, row) {
    if (err) {
      console.error('Error checking for resource_name column:', err);
    } else if (!row) {
      // Column doesn't exist, add it
      console.log('Adding resource_name column...');
      db.run(`ALTER TABLE permissions ADD COLUMN resource_name VARCHAR(50)`);
    } else {
      console.log('resource_name column already exists');
    }
  });
  
  // 2. Check if action column exists by directly executing ALTER TABLE
  console.log('2. Adding action column if not exists');
  db.run(`
    SELECT 1 FROM pragma_table_info('permissions') WHERE name='action'
  `, function(err, row) {
    if (err) {
      console.error('Error checking for action column:', err);
    } else if (!row) {
      // Column doesn't exist, add it
      console.log('Adding action column...');
      db.run(`ALTER TABLE permissions ADD COLUMN action VARCHAR(50)`);
    } else {
      console.log('action column already exists');
    }
  });
  
  // 3. Update the resource_name and action columns for existing records
  console.log('3. Updating resource_name and action from name field');
  db.run(`
    UPDATE permissions
    SET resource_name = SUBSTR(name, 1, INSTR(name, ':') - 1)
    WHERE resource_name IS NULL AND INSTR(name, ':') > 0
  `);
  
  db.run(`
    UPDATE permissions
    SET action = SUBSTR(name, INSTR(name, ':') + 1)
    WHERE action IS NULL AND INSTR(name, ':') > 0
  `);
  
  // 4. Create indexes for faster queries
  console.log('4. Creating indexes');
  db.run(`CREATE INDEX IF NOT EXISTS idx_permissions_resource_name ON permissions (resource_name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_permissions_action ON permissions (action)`);
  
  // Commit the transaction
  db.run('COMMIT', function(err) {
    if (err) {
      console.error('Error committing transaction:', err);
    } else {
      console.log('Transaction committed successfully');
      
      // 5. Verify the changes
      console.log('5. Verifying changes');
      db.all(`PRAGMA table_info(permissions)`, function(err, rows) {
        if (err) {
          console.error('Error getting columns:', err);
        } else {
          const columnNames = rows.map(row => row.name);
          console.log('Columns in permissions table:', columnNames.join(', '));
          
          db.all(`SELECT * FROM permissions LIMIT 5`, function(err, rows) {
            if (err) {
              console.error('Error getting permissions:', err);
            } else {
              console.log('\nSample permissions:');
              for (const row of rows) {
                console.log(`- ${row.name} (${row.resource_name}:${row.action})`);
              }
            }
            
            // Close the database connection
            db.close(function(err) {
              if (err) {
                console.error('Error closing database:', err);
              } else {
                console.log('\nDatabase connection closed. Schema fix completed.');
              }
            });
          });
        }
      });
    }
  });
}); 