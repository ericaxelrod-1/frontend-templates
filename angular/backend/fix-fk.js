// Check for user table and fix login_attempt foreign key
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./db.sqlite');
db.serialize(() => {
  db.get(\
SELECT
name
FROM
sqlite_master
WHERE
type=table
AND
name=login_attempt\, (err, row) => {
    if (err) { console.error(err); return; }
    console.log('Login attempt table exists:', !!row);
  });
  db.all(\
PRAGMA
foreign_key_list
login_attempt
\, (err, fkeys) => {
    if (err) { console.error(err); return; }
    console.log('Foreign keys:', JSON.stringify(fkeys));
  });
  db.close();
});
