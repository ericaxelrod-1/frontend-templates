const sqlite3 = require('sqlite3').verbose(); const db = new sqlite3.Database('./db.sqlite'); db.all(\
SELECT
name
FROM
sqlite_master
WHERE
type=table
AND
name
LIKE
%role%
\, [], (err, tables) => { if (err) { console.error('Error:', err); return; } console.log('Role-related tables:', JSON.stringify(tables, null, 2)); db.close(); });
