const sqlite3 = require('sqlite3'); const db = new sqlite3.Database('./db.sqlite'); db.all(\
SELECT
name
FROM
sqlite_master
WHERE
type=table
AND
name=user\, [], (err, rows) => { if (err) { console.error('Error:', err); } else { console.log('User table exists:', rows.length > 0); if (rows.length > 0) { console.log(rows); } } db.close(); });
