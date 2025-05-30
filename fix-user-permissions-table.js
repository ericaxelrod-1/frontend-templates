const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Load configuration
let config;
try {
  const configPath = path.resolve('./config.json');
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('Loaded configuration from config.json');
} catch (err) {
  console.error('Error loading config.json, using defaults:', err.message);
  config = {
    debug_mode: true,
    log_directory: 'logs',
    connection_timeout: 5000,
    database: {
      path: './src/database/database.sqlite',
      backup_directory: './backup',
      enable_foreign_keys: true,
      create_missing_tables: true
    },
    validation: {
      enable_auto_fix: false,
      check_on_startup: true
    }
  };
}

// Define the database path
const dbPath = path.resolve(config.database.path);
const backupDir = path.resolve(config.database.backup_directory);
const logDir = path.resolve(config.log_directory);
const debugMode = config.debug_mode;

// Create necessary directories
[path.dirname(dbPath), backupDir, logDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    } catch (err) {
      console.error(`Failed to create directory ${dir}: ${err.message}`);
      process.exit(1);
    }
  }
});

// Output for logging - create a log file
const timestamp = new Date().toISOString().replace(/[:.]/g, '_');
const logFile = path.resolve(`${logDir}/user_permissions_fix_${timestamp}.log`);

// Create a write stream for logging
const logStream = fs.createWriteStream(logFile, {flags: 'a'});

function log(message, isError = false) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  
  // Log to console
  if (isError) {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }
  
  // Log to file
  logStream.write(logMessage + '\n');
}

// Create backup of existing database if it exists
function backupDatabase() {
  if (fs.existsSync(dbPath)) {
    const backupFile = path.join(backupDir, `database_backup_${timestamp}.sqlite`);
    try {
      fs.copyFileSync(dbPath, backupFile);
      log(`Created database backup at ${backupFile}`);
      return true;
    } catch (err) {
      log(`Failed to create database backup: ${err.message}`, true);
      return false;
    }
  }
  return true; // No backup needed if file doesn't exist
}

// Verify database file exists
if (!fs.existsSync(dbPath)) {
  log(`Database file not found at ${dbPath}. Please run fix-database.js first.`, true);
  logStream.end();
  process.exit(1);
}

// Create backup before making changes
if (!backupDatabase()) {
  log('Proceeding without backup - use caution', true);
}

// Open the database with a timeout
let dbOpenTimeout = setTimeout(() => {
  log(`Timed out after ${config.connection_timeout}ms while trying to connect to database`, true);
  logStream.end();
  process.exit(1);
}, config.connection_timeout);

// Open the database
const db = new sqlite3.Database(dbPath, (err) => {
  clearTimeout(dbOpenTimeout);
  if (err) {
    log(`Error opening database: ${err.message}`, true);
    logStream.end();
    process.exit(1);
  }
  log(`Connected to the SQLite database at ${dbPath}`);
  
  // Enable foreign keys if configured
  if (config.database.enable_foreign_keys) {
    db.run('PRAGMA foreign_keys = OFF;', [], err => {
      if (err) {
        log(`Error disabling foreign keys for migration: ${err.message}`, true);
      } else {
        log('Foreign key constraints temporarily disabled for migration');
      }
      fixUserPermissionsTable();
    });
  } else {
    log('Foreign key constraints already disabled based on configuration');
    fixUserPermissionsTable();
  }
});

// Fix the user_permissions table issue
function fixUserPermissionsTable() {
  log('Starting user_permissions table migration fix');
  
  // Check if both tables exist
  checkTableExists('user_permissions', (hasUserPermissionsTable) => {
    checkTableExists('user_permission', (hasUserPermissionTable) => {
      if (!hasUserPermissionsTable) {
        log('No user_permissions (plural) table found, no migration needed.');
        finish();
        return;
      }
      
      if (!hasUserPermissionTable) {
        log('user_permission (singular) table not found. Creating it first...');
        createUserPermissionTable(() => {
          migrateData();
        });
      } else {
        log('Both tables exist. Will migrate data and drop the plural table.');
        migrateData();
      }
    });
  });
}

// Check if a table exists in the database
function checkTableExists(tableName, callback) {
  db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName], (err, row) => {
    if (err) {
      log(`Error checking if table ${tableName} exists: ${err.message}`, true);
      callback(false);
      return;
    }
    callback(!!row);
  });
}

// Create the singular user_permission table
function createUserPermissionTable(callback) {
  log('Creating user_permission table');
  db.run(`
    CREATE TABLE IF NOT EXISTS user_permission (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      granted BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES permission(id) ON DELETE CASCADE,
      UNIQUE (user_id, permission_id)
    )
  `, function(err) {
    if (err) {
      log(`Error creating user_permission table: ${err.message}`, true);
      finish();
      return;
    }
    
    log('user_permission table created successfully');
    
    // Create indexes for the user_permission table
    db.run('CREATE INDEX IF NOT EXISTS idx_user_permission_user_id ON user_permission(user_id)', function(err) {
      if (err) {
        log(`Error creating user_id index: ${err.message}`, true);
      }
      
      db.run('CREATE INDEX IF NOT EXISTS idx_user_permission_permission_id ON user_permission(permission_id)', function(err) {
        if (err) {
          log(`Error creating permission_id index: ${err.message}`, true);
        }
        
        callback();
      });
    });
  });
}

// Migrate data from user_permissions to user_permission
function migrateData() {
  log('Migrating data from user_permissions to user_permission table');
  
  // Get count of records in the plural table
  db.get('SELECT COUNT(*) as count FROM user_permissions', [], (err, result) => {
    if (err) {
      log(`Error counting records in user_permissions table: ${err.message}`, true);
      finish();
      return;
    }
    
    const recordCount = result ? result.count : 0;
    log(`Found ${recordCount} records to migrate`);
    
    if (recordCount === 0) {
      log('No records to migrate, proceeding to drop the table');
      dropPluralTable();
      return;
    }
    
    // Get all records from the plural table
    db.all('SELECT * FROM user_permissions', [], (err, rows) => {
      if (err) {
        log(`Error retrieving records from user_permissions table: ${err.message}`, true);
        finish();
        return;
      }
      
      // Begin transaction for the migration
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) {
          log(`Error starting transaction: ${err.message}`, true);
          finish();
          return;
        }
        
        let recordsProcessed = 0;
        let recordsSkipped = 0;
        
        // Process each record
        rows.forEach((row) => {
          // Insert into the singular table with INSERT OR IGNORE to handle duplicates
          const stmt = db.prepare(`
            INSERT OR IGNORE INTO user_permission 
            (id, user_id, permission_id, granted, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?)
          `);
          
          stmt.run(
            row.id, 
            row.user_id, 
            row.permission_id, 
            row.granted, 
            row.created_at, 
            row.updated_at, 
            function(err) {
              if (err) {
                log(`Error inserting record ${row.id}: ${err.message}`, true);
                recordsSkipped++;
              } else {
                if (this.changes === 0) {
                  recordsSkipped++;
                  if (debugMode) {
                    log(`Skipped record: ${JSON.stringify(row)} (likely already exists)`);
                  }
                } else {
                  recordsProcessed++;
                  if (debugMode) {
                    log(`Migrated record: ${JSON.stringify(row)}`);
                  }
                }
              }
              
              // Check if all records have been processed
              if (recordsProcessed + recordsSkipped === rows.length) {
                log(`Migration summary: ${recordsProcessed} records migrated, ${recordsSkipped} records skipped`);
                
                // Commit the transaction
                db.run('COMMIT', (err) => {
                  if (err) {
                    log(`Error committing transaction: ${err.message}`, true);
                    db.run('ROLLBACK');
                    finish();
                    return;
                  }
                  
                  log('Transaction committed successfully');
                  dropPluralTable();
                });
              }
            }
          );
          
          stmt.finalize();
        });
        
        // Handle the case of no records to process
        if (rows.length === 0) {
          db.run('COMMIT');
          log('No records to migrate');
          dropPluralTable();
        }
      });
    });
  });
}

// Drop the plural user_permissions table
function dropPluralTable() {
  log('Dropping user_permissions (plural) table');
  
  db.run('DROP TABLE IF EXISTS user_permissions', (err) => {
    if (err) {
      log(`Error dropping user_permissions table: ${err.message}`, true);
    } else {
      log('user_permissions (plural) table dropped successfully');
    }
    
    // Drop related indexes if they exist
    db.run('DROP INDEX IF EXISTS idx_user_permissions_user_id', (err) => {
      if (err && debugMode) {
        log(`Error dropping idx_user_permissions_user_id index: ${err.message}`, true);
      }
      
      db.run('DROP INDEX IF EXISTS idx_user_permissions_permission_id', (err) => {
        if (err && debugMode) {
          log(`Error dropping idx_user_permissions_permission_id index: ${err.message}`, true);
        }
        
        log('Migration completed successfully');
        // Re-enable foreign keys
        enableForeignKeys();
      });
    });
  });
}

// Re-enable foreign keys
function enableForeignKeys() {
  if (config.database.enable_foreign_keys) {
    db.run('PRAGMA foreign_keys = ON;', [], err => {
      if (err) {
        log(`Error enabling foreign keys: ${err.message}`, true);
      } else {
        log('Foreign key constraints re-enabled');
      }
      finish();
    });
  } else {
    finish();
  }
}

// Clean up and finish
function finish() {
  db.close((err) => {
    if (err) {
      log(`Error closing database: ${err.message}`, true);
    } else {
      log('Database connection closed');
    }
    log(`User permissions table fix complete. Log file saved to: ${logFile}`);
    logStream.end();
  });
} 