import * as sqlite3 from 'sqlite3';
import * as path from 'path';

const dbPath = path.resolve(__dirname, '..', '..', 'db.sqlite');
console.log(`Using database at: ${dbPath}`);

const db = new sqlite3.Database(dbPath);

// Define the column structure
interface SQLiteColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

// Get table info to check if columns exist
db.all("PRAGMA table_info(groups)", [], (err, columns: SQLiteColumn[]) => {
  if (err) {
    console.error("Error checking groups table:", err);
    db.close();
    return;
  }

  // Extract column names
  const columnNames = columns.map(col => col.name);
  console.log("Existing columns:", columnNames);

  // Add missing columns if they don't exist
  const columnsToAdd = [
    { name: 'is_system_group', definition: 'BOOLEAN DEFAULT FALSE' },
    { name: 'settings', definition: 'TEXT' },
    { name: 'created_at', definition: 'DATETIME' },
    { name: 'updated_at', definition: 'DATETIME' }
  ];

  // Process each column
  let pendingQueries = columnsToAdd.length;
  let errorsOccurred = false;

  columnsToAdd.forEach(column => {
    if (!columnNames.includes(column.name)) {
      const query = `ALTER TABLE groups ADD COLUMN ${column.name} ${column.definition}`;
      console.log(`Executing: ${query}`);

      db.run(query, (alterErr) => {
        pendingQueries--;

        if (alterErr) {
          console.error(`Error adding column ${column.name}:`, alterErr);
          errorsOccurred = true;
        } else {
          console.log(`Successfully added column ${column.name}`);
          
          // For timestamp columns, add a separate update to set the default value
          if (column.name === 'created_at' || column.name === 'updated_at') {
            const updateQuery = `UPDATE groups SET ${column.name} = CURRENT_TIMESTAMP WHERE ${column.name} IS NULL`;
            console.log(`Executing: ${updateQuery}`);
            
            db.run(updateQuery, (updateErr) => {
              if (updateErr) {
                console.error(`Error updating ${column.name}:`, updateErr);
              } else {
                console.log(`Successfully updated ${column.name} values`);
              }
            });
          }
        }

        // Check if all queries are completed
        if (pendingQueries === 0) {
          if (errorsOccurred) {
            console.error("Completed with errors");
          } else {
            console.log("All columns added successfully");
          }
          // Give time for the update queries to complete
          setTimeout(() => {
            db.close();
            console.log("Database connection closed");
          }, 500);
        }
      });
    } else {
      console.log(`Column ${column.name} already exists`);
      pendingQueries--;

      // Check if all queries are completed
      if (pendingQueries === 0) {
        console.log("No columns needed to be added");
        db.close();
      }
    }
  });
}); 