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

// Get the table schema
db.all("PRAGMA table_info(user_permission);", [], (err, rows) => {
  if (err) {
    console.error(`Error getting schema: ${err.message}`);
    process.exit(1);
  }
  
  console.log("Table schema for user_permission:");
  console.table(rows);
  
  // Get the CREATE statement
  db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_permission';", [], (err, row) => {
    if (err) {
      console.error(`Error getting CREATE statement: ${err.message}`);
    } else if (row) {
      console.log("\nCREATE statement:");
      console.log(row.sql);
    } else {
      console.log("Table not found in sqlite_master");
    }
    
    // Check for indexes on this table
    db.all("SELECT * FROM sqlite_master WHERE type='index' AND tbl_name='user_permission';", [], (err, indexes) => {
      if (err) {
        console.error(`Error getting indexes: ${err.message}`);
      } else {
        console.log("\nIndexes on user_permission:");
        console.table(indexes);
      }
      
      // Close the database connection
      db.close();
    });
  });
}); 