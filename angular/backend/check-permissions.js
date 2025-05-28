const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db.sqlite');

db.all('PRAGMA table_info(permissions)', [], (err, columns) => {
  if (err) {
    console.error('Error:', err);
    return;
  }
  console.log('Permissions table schema:', JSON.stringify(columns, null, 2));
  db.close();
});
