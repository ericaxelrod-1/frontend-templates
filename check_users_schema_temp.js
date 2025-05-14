const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, 'db.sqlite');

console.log(`[SchemaCheck] Inspecting database: ${dbPath}`);

if (!fs.existsSync(dbPath)) {
  console.error(`[SchemaCheck] Database file NOT FOUND: ${dbPath}`);
  process.exit(1);
}

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error(`[SchemaCheck] Error opening database: ${err.message}`);
    process.exit(1);
  }
  console.log('[SchemaCheck] Successfully connected to database.');

  db.all("PRAGMA table_info(users);", (err, rows) => {
    if (err) {
      console.error('[SchemaCheck] Error executing PRAGMA table_info(users):', err.message);
    } else {
      if (!rows || rows.length === 0) {
        console.log('[SchemaCheck] \'users\' table not found or has no columns.');
      } else {
        console.log('[SchemaCheck] Schema for \'users\' table:');
        console.log(JSON.stringify(rows, null, 2));
      }
    }
    db.close((closeErr) => {
      if (closeErr) {
        console.error('[SchemaCheck] Error closing database:', closeErr.message);
      }
      console.log('[SchemaCheck] Database connection closed.');
    });
  });
}); 