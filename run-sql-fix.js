const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Get the SQL commands from the file
const sqlFile = path.join(__dirname, 'direct-schema-fix.sql');
const sqlCommands = fs.readFileSync(sqlFile, 'utf8');

// Connect to the database
const dbPath = path.join(__dirname, 'db.sqlite');
console.log(`Opening database at ${dbPath}`);
const db = new sqlite3.Database(dbPath);

// Execute the SQL commands
console.log('Executing SQL commands...');
db.exec(sqlCommands, function(err) {
  if (err) {
    console.error('Error executing SQL:', err);
    process.exit(1);
  }
  
  console.log('SQL commands executed successfully!');
  
  // Show some verification
  db.all('SELECT COUNT(*) as count FROM permissions', [], function(err, rows) {
    if (err) {
      console.error('Error counting permissions:', err);
    } else {
      console.log(`Number of permissions in database: ${rows[0].count}`);
    }
    
    db.all('SELECT COUNT(*) as count FROM roles', [], function(err, rows) {
      if (err) {
        console.error('Error counting roles:', err);
      } else {
        console.log(`Number of roles in database: ${rows[0].count}`);
      }
      
      db.all('SELECT COUNT(*) as count FROM role_permissions', [], function(err, rows) {
        if (err) {
          console.error('Error counting role permissions:', err);
        } else {
          console.log(`Number of role-permission relationships: ${rows[0].count}`);
        }
        
        // Display a sample of permissions
        db.all('SELECT * FROM permissions LIMIT 5', [], function(err, rows) {
          if (err) {
            console.error('Error getting sample permissions:', err);
          } else {
            console.log('\nSample permissions:');
            rows.forEach(row => {
              console.log(`- ${row.name} (${row.resource_name}:${row.action})`);
            });
          }
          
          // Close the database connection
          db.close();
          console.log('\nDatabase connection closed.');
        });
      });
    });
  });
}); 