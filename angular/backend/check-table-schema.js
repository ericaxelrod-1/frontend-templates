const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db.sqlite');

const tables = [
  'users',
  'permissions',
  'roles',
  'user_roles',
  'role_permissions'
];

let completed = 0;
console.log("Starting database schema check...");

// Process one table at a time sequentially to avoid output mixing
function checkNextTable(index) {
  if (index >= tables.length) {
    console.log("All tables checked. Closing database.");
    db.close();
    return;
  }
  
  const table = tables[index];
  console.log(`\nChecking schema for table: ${table}`);
  
  db.all(`PRAGMA table_info(${table})`, [], (err, columns) => {
    if (err) {
      console.error(`Error checking ${table}:`, err);
    } else {
      console.log(`${table} table schema:`, JSON.stringify(columns, null, 2));
    }
    
    // Check the next table
    checkNextTable(index + 1);
  });
}

// Start the process
checkNextTable(0); 