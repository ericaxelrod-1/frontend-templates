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

// Database path
const dbPath = path.resolve(config.database.path);
const logDir = path.resolve(config.log_directory);
const debugMode = config.debug_mode;

// Create necessary directories
[logDir].forEach(dir => {
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

// Output for logging
const timestamp = new Date().toISOString().replace(/[:.]/g, '_');
const logFile = path.resolve(`${logDir}/database_check_${timestamp}.log`);
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

// Verify database file exists
if (!fs.existsSync(dbPath)) {
  log(`Database file not found at ${dbPath}. Please run fix-database.js first.`, true);
  logStream.end();
  process.exit(1);
}

// Check database file size
const stats = fs.statSync(dbPath);
log(`Database file size: ${formatBytes(stats.size)}`);
if (stats.size === 0) {
  log(`Warning: Database file exists but is empty (0 bytes)`, true);
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
    db.run('PRAGMA foreign_keys = ON;', [], err => {
      if (err) {
        log(`Error enabling foreign keys: ${err.message}`, true);
      } else {
        log('Foreign key constraints enabled for validation');
      }
      startDatabaseCheck();
    });
  } else {
    log('Foreign key constraints disabled based on configuration');
    startDatabaseCheck();
  }
});

function startDatabaseCheck() {
  // Get SQLite version
  db.get('SELECT sqlite_version() as version', [], (err, row) => {
    if (err) {
      log(`Error getting SQLite version: ${err.message}`, true);
    } else {
      log(`SQLite version: ${row.version}`);
    }
    
    // Check database integrity
    log('Checking database integrity...');
    db.get('PRAGMA integrity_check', [], (err, result) => {
      if (err) {
        log(`Error checking database integrity: ${err.message}`, true);
      } else {
        const status = result.integrity_check === 'ok' ? 'OK' : 'FAILED';
        log(`Database integrity check: ${status}`);
        if (status !== 'OK') {
          log(`Integrity check details: ${JSON.stringify(result)}`, true);
        }
      }
      
      // Get all tables
      db.all(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`, [], (err, tables) => {
        if (err) {
          log(`Error getting tables: ${err.message}`, true);
          closeDatabase();
          return;
        }
        
        if (tables.length === 0) {
          log('No tables found in the database. The database is empty.', true);
          closeDatabase();
          return;
        }
        
        log(`Found ${tables.length} tables in database:`);
        tables.forEach((table) => {
          log(`- ${table.name}`);
        });
        
        // Track completed table checks
        let tablesProcessed = 0;
        const tableCount = tables.length;
        
        // For each table, get its structure and check its contents
        tables.forEach((table) => {
          checkTable(table.name, () => {
            tablesProcessed++;
            if (tablesProcessed === tableCount) {
              checkDatabaseConstraints();
            }
          });
        });
      });
    });
  });
}

function checkTable(tableName, callback) {
  // Get table info (columns)
  db.all(`PRAGMA table_info(${tableName})`, [], (err, columns) => {
    if (err) {
      log(`Error getting columns for table ${tableName}: ${err.message}`, true);
      callback();
      return;
    }
    
    log(`\nStructure of table ${tableName}:`);
    
    if (columns.length === 0) {
      log(`  (No columns found - table may be corrupted)`, true);
      callback();
      return;
    }
    
    // Print column details
    columns.forEach((column) => {
      const nullable = column.notnull === 0 ? 'NULL' : 'NOT NULL';
      const primaryKey = column.pk === 1 ? 'PRIMARY KEY' : '';
      const defaultValue = column.dflt_value ? `DEFAULT ${column.dflt_value}` : '';
      
      log(`  - ${column.name} (${column.type}) ${nullable} ${primaryKey} ${defaultValue}`.trim());
    });
    
    // Get foreign key constraints for this table
    db.all(`PRAGMA foreign_key_list(${tableName})`, [], (err, foreignKeys) => {
      if (err) {
        log(`Error getting foreign keys for ${tableName}: ${err.message}`, true);
      } else if (foreignKeys.length > 0) {
        log(`  Foreign Keys for ${tableName}:`);
        foreignKeys.forEach(fk => {
          log(`    - Column '${fk.from}' references ${fk.table}(${fk.to}) [seq: ${fk.seq}]`);
        });
      } else if (debugMode) {
        log(`  No foreign keys defined for ${tableName}`);
      }
      
      // Check for indexes on this table
      db.all(`PRAGMA index_list(${tableName})`, [], (err, indexes) => {
        if (err) {
          log(`Error getting indexes for table ${tableName}: ${err.message}`, true);
        } else if (indexes.length > 0) {
          log(`  Indexes on ${tableName}:`);
          indexes.forEach(index => {
            log(`    - ${index.name} (${index.unique ? 'UNIQUE' : 'NOT UNIQUE'})`);
            
            // Get columns in this index
            if (debugMode) {
              db.all(`PRAGMA index_info(${index.name})`, [], (err, indexColumns) => {
                if (!err && indexColumns.length > 0) {
                  const columnNames = indexColumns.map(ic => `${ic.name}`).join(', ');
                  log(`      Columns: ${columnNames}`);
                }
              });
            }
          });
        } else if (debugMode) {
          log(`  No indexes defined for ${tableName}`);
        }
        
        // Get row count for this table
        db.get(`SELECT COUNT(*) as count FROM ${tableName}`, [], (err, result) => {
          if (err) {
            log(`Error getting row count for table ${tableName}: ${err.message}`, true);
            callback();
          } else {
            log(`  Row count: ${result.count}`);
            
            // If table has data and debug mode is on, show a sample
            if (result.count > 0 && debugMode) {
              db.all(`SELECT * FROM ${tableName} LIMIT 3`, [], (err, rows) => {
                if (!err && rows.length > 0) {
                  log(`  Sample data (first ${Math.min(3, rows.length)} rows):`);
                  rows.forEach((row, i) => {
                    log(`    Row ${i+1}: ${JSON.stringify(row)}`);
                  });
                }
                callback();
              });
            } else {
              callback();
            }
          }
        });
      });
    });
  });
}

function checkDatabaseConstraints() {
  log('\nChecking database constraints and relationships...');
  
  // Check foreign key integrity
  db.all('PRAGMA foreign_key_check', [], (err, violations) => {
    if (err) {
      log(`Error checking foreign key constraints: ${err.message}`, true);
    } else if (violations.length > 0) {
      log(`⚠️ Found ${violations.length} foreign key constraint violations:`, true);
      violations.forEach((v, i) => {
        log(`  ${i+1}. Table: ${v.table}, Row ID: ${v.rowid}, Parent: ${v.parent}, Foreign Key Index: ${v.fkid}`, true);
      });
    } else {
      log('✓ No foreign key constraint violations found');
    }
    
    // Report on expected tables
    const expectedTables = [
      'permission', 'roles', 'users', 'groups', 
      'user_permission', 'role_permissions', 'user_groups', 'user_roles',
      'api_endpoints', 'frontend_routes', 'ui_components',
      'actions', 'resources', 'cache_permission_map'
    ];
    
    db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
      if (err) {
        log(`Error getting table list: ${err.message}`, true);
      } else {
        const tableNames = tables.map(t => t.name);
        const missingTables = expectedTables.filter(t => !tableNames.includes(t));
        
        if (missingTables.length > 0) {
          log(`⚠️ Missing expected tables: ${missingTables.join(', ')}`, true);
        } else {
          log('✓ All expected tables are present');
        }
      }
      
      // Complete validation and close
      closeDatabase();
    });
  });
}

function closeDatabase() {
  // Close the database connection
  db.close((err) => {
    if (err) {
      log(`Error closing database: ${err.message}`, true);
    } else {
      log('\nDatabase validation complete');
      log(`Full report saved to: ${logFile}`);
    }
    logStream.end();
  });
}

// Utility function to format bytes
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
} 