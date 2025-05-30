const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to the database
const dbPath = path.resolve('./src/database/database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error(`Error opening database: ${err.message}`);
    process.exit(1);
  }
  console.log(`Connected to the SQLite database at ${dbPath}`);
});

db.all("PRAGMA table_info(role_permissions);", [], (err, rows) => {
  if (err) {
    console.error(`Error getting schema: ${err.message}`);
    process.exit(1);
  }
  console.log("Table schema for role_permissions:");
  console.table(rows);
  db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='role_permissions';", [], (err, row) => {
    if (err) {
      console.error(`Error getting CREATE statement: ${err.message}`);
    } else if (row) {
      console.log("\nCREATE statement:");
      console.log(row.sql);
    } else {
      console.log("Table not found in sqlite_master");
    }
    db.close();
  });
}); 