const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db.sqlite');

console.log("Checking permissions table schema...");

db.all(`PRAGMA table_info(permissions)`, [], (err, columns) => {
  if (err) {
    console.error('Error checking permissions table:', err);
  } else {
    console.log('Permissions table schema:', JSON.stringify(columns, null, 2));
  }
  db.close();
}); 