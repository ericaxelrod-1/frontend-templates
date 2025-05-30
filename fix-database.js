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
const logFile = path.resolve(`${logDir}/database_fix_${timestamp}.log`);

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

// Check if the database file exists
if (!fs.existsSync(dbPath)) {
  log(`Database file not found at ${dbPath}, creating empty database`);
  try {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    fs.writeFileSync(dbPath, '');
    log(`Created empty database file at ${dbPath}`);
  } catch (err) {
    log(`Failed to create database file: ${err.message}`, true);
    logStream.end();
    process.exit(1);
  }
} else {
  log(`Found existing database at ${dbPath}`);
  // Create backup before making changes
  if (!backupDatabase()) {
    log('Proceeding without backup - use caution', true);
  }
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
});

// Run in sequence
db.serialize(() => {
  // Enable foreign keys if configured
  if (config.database.enable_foreign_keys) {
    db.run('PRAGMA foreign_keys = ON;', [], err => {
      if (err) {
        log(`Error enabling foreign keys: ${err.message}`, true);
      } else {
        log('Foreign key constraints enabled');
      }
    });
  } else {
    log('Foreign key constraints disabled based on configuration');
  }
  
  // Create tables
  createPermissionTable();
  createRolesTable();
  createGroupsTable();
  createUsersTable();
  createUserPermissionTable();
  createRolePermissionsTable();
  createUserGroupsTable();
  createUserRolesTable();
  createApiEndpointsTable();
  createFrontendRoutesTable();
  createUiComponentsTable();
  createActionsTable();
  createResourcesTable();
  createCachePermissionMapTable();
  
  // After all tables are created, populate default data
  populateDefaultData();
});

// Create permission table
function createPermissionTable() {
  log('Checking/creating permission table');
  db.run(`
    CREATE TABLE IF NOT EXISTS permission (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      resource_name VARCHAR(50) NOT NULL,
      action VARCHAR(50) NOT NULL,
      action_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(resource_name, action)
    )
  `, function(err) {
    if (err) {
      log(`Error creating permission table: ${err.message}`, true);
    } else {
      log('Permission table created or already exists');
      
      // Create indexes - moved inside the callback to ensure they run after table creation
      db.run('CREATE INDEX IF NOT EXISTS idx_permission_resource ON permission(resource_name)', function(err) {
        if (err && debugMode) {
          log(`Error creating resource_name index: ${err.message}`, true);
        }
      });
      
      db.run('CREATE INDEX IF NOT EXISTS idx_permission_action ON permission(action)', function(err) {
        if (err && debugMode) {
          log(`Error creating action index: ${err.message}`, true);
        }
      });
    }
  });
}

// Create roles table
function createRolesTable() {
  log('Checking/creating roles table');
  db.run(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      is_system_role BOOLEAN DEFAULT 0,
      is_default BOOLEAN DEFAULT 0,
      parent_id INTEGER,
      priority INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES roles(id) ON DELETE SET NULL
    )
  `, function(err) {
    if (err) {
      log(`Error creating roles table: ${err.message}`, true);
    } else {
      log('Roles table created or already exists');
      // Create indexes
      db.run('CREATE INDEX IF NOT EXISTS idx_roles_parent_id ON roles(parent_id)', function(err) {
        if (err && debugMode) {
          log(`Error creating parent_id index: ${err.message}`, true);
        }
      });
    }
  });
}

// Create groups table
function createGroupsTable() {
  log('Checking/creating groups table');
  db.run(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      is_system_group BOOLEAN DEFAULT 0,
      settings TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, function(err) {
    if (err) {
      log(`Error creating groups table: ${err.message}`, true);
    } else {
      log('Groups table created or already exists');
    }
  });
}

// Create users table
function createUsersTable() {
  log('Checking/creating users table');
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email VARCHAR(100) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      is_active BOOLEAN DEFAULT 1,
      is_verified BOOLEAN DEFAULT 0,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, function(err) {
    if (err) {
      log(`Error creating users table: ${err.message}`, true);
    } else {
      log('Users table created or already exists');
      // Create indexes
      db.run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)', function(err) {
        if (err && debugMode) {
          log(`Error creating email index: ${err.message}`, true);
        }
      });
      
      db.run('CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active)', function(err) {
        if (err && debugMode) {
          log(`Error creating is_active index: ${err.message}`, true);
        }
      });
    }
  });
}

// Create user_permission table
function createUserPermissionTable() {
  log('Checking/creating user_permission table');
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
    } else {
      log('user_permission table created or already exists');
      
      // Create indexes for the user_permission table
      db.run('CREATE INDEX IF NOT EXISTS idx_user_permission_user_id ON user_permission(user_id)', function(err) {
        if (err && debugMode) {
          log(`Error creating user_id index: ${err.message}`, true);
        }
      });
      
      db.run('CREATE INDEX IF NOT EXISTS idx_user_permission_permission_id ON user_permission(permission_id)', function(err) {
        if (err && debugMode) {
          log(`Error creating permission_id index: ${err.message}`, true);
        }
      });
    }
  });
}

// Create role_permissions table
function createRolePermissionsTable() {
  log('Checking/creating role_permissions table');
  db.run(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      granted BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES permission(id) ON DELETE CASCADE,
      UNIQUE (role_id, permission_id)
    )
  `, function(err) {
    if (err) {
      log(`Error creating role_permissions table: ${err.message}`, true);
    } else {
      log('Role_permissions table created or already exists');
      
      // Create indexes for the role_permissions table
      db.run('CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id)', function(err) {
        if (err && debugMode) {
          log(`Error creating role_id index: ${err.message}`, true);
        }
      });
      
      db.run('CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id)', function(err) {
        if (err && debugMode) {
          log(`Error creating permission_id index: ${err.message}`, true);
        }
      });
    }
  });
}

// Create user_groups table
function createUserGroupsTable() {
  log('Checking/creating user_groups table');
  db.run(`
    CREATE TABLE IF NOT EXISTS user_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      UNIQUE (user_id, group_id)
    )
  `, function(err) {
    if (err) {
      log(`Error creating user_groups table: ${err.message}`, true);
    } else {
      log('User_groups table created or already exists');
      
      // Create indexes
      db.run('CREATE INDEX IF NOT EXISTS idx_user_groups_user_id ON user_groups(user_id)', function(err) {
        if (err && debugMode) {
          log(`Error creating user_id index: ${err.message}`, true);
        }
      });
      
      db.run('CREATE INDEX IF NOT EXISTS idx_user_groups_group_id ON user_groups(group_id)', function(err) {
        if (err && debugMode) {
          log(`Error creating group_id index: ${err.message}`, true);
        }
      });
    }
  });
}

// Create user_roles table
function createUserRolesTable() {
  log('Checking/creating user_roles table');
  db.run(`
    CREATE TABLE IF NOT EXISTS user_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      UNIQUE (user_id, role_id)
    )
  `, function(err) {
    if (err) {
      log(`Error creating user_roles table: ${err.message}`, true);
    } else {
      log('User_roles table created or already exists');
      
      // Create indexes
      db.run('CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id)', function(err) {
        if (err && debugMode) {
          log(`Error creating user_id index: ${err.message}`, true);
        }
      });
      
      db.run('CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id)', function(err) {
        if (err && debugMode) {
          log(`Error creating role_id index: ${err.message}`, true);
        }
      });
    }
  });
}

// Create api_endpoints table
function createApiEndpointsTable() {
  log('Checking/creating api_endpoints table');
  db.run(`
    CREATE TABLE IF NOT EXISTS api_endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path VARCHAR(255) NOT NULL,
      method VARCHAR(20) NOT NULL,
      controller VARCHAR(100),
      action VARCHAR(100),
      required_permissions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (path, method)
    )
  `, function(err) {
    if (err) {
      log(`Error creating api_endpoints table: ${err.message}`, true);
    } else {
      log('Api_endpoints table created or already exists');
      
      // Create indexes
      db.run('CREATE INDEX IF NOT EXISTS idx_api_endpoints_path ON api_endpoints(path)', function(err) {
        if (err && debugMode) {
          log(`Error creating path index: ${err.message}`, true);
        }
      });
      
      db.run('CREATE INDEX IF NOT EXISTS idx_api_endpoints_method ON api_endpoints(method)', function(err) {
        if (err && debugMode) {
          log(`Error creating method index: ${err.message}`, true);
        }
      });
    }
  });
}

// Create frontend_routes table
function createFrontendRoutesTable() {
  log('Checking/creating frontend_routes table');
  db.run(`
    CREATE TABLE IF NOT EXISTS frontend_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path VARCHAR(255) NOT NULL UNIQUE,
      component VARCHAR(100),
      required_permissions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, function(err) {
    if (err) {
      log(`Error creating frontend_routes table: ${err.message}`, true);
    } else {
      log('Frontend_routes table created or already exists');
      
      // Create indexes
      db.run('CREATE INDEX IF NOT EXISTS idx_frontend_routes_path ON frontend_routes(path)', function(err) {
        if (err && debugMode) {
          log(`Error creating path index: ${err.message}`, true);
        }
      });
    }
  });
}

// Create ui_components table
function createUiComponentsTable() {
  log('Checking/creating ui_components table');
  db.run(`
    CREATE TABLE IF NOT EXISTS ui_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(100) NOT NULL UNIQUE,
      selector VARCHAR(100),
      required_permissions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, function(err) {
    if (err) {
      log(`Error creating ui_components table: ${err.message}`, true);
    } else {
      log('Ui_components table created or already exists');
      
      // Create indexes
      db.run('CREATE INDEX IF NOT EXISTS idx_ui_components_name ON ui_components(name)', function(err) {
        if (err && debugMode) {
          log(`Error creating name index: ${err.message}`, true);
        }
      });
    }
  });
}

// Create actions table
function createActionsTable() {
  log('Checking/creating actions table');
  db.run(`
    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(50) NOT NULL UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, function(err) {
    if (err) {
      log(`Error creating actions table: ${err.message}`, true);
    } else {
      log('Actions table created or already exists');
    }
  });
}

// Create resources table
function createResourcesTable() {
  log('Checking/creating resources table');
  db.run(`
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(50) NOT NULL UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, function(err) {
    if (err) {
      log(`Error creating resources table: ${err.message}`, true);
    } else {
      log('Resources table created or already exists');
    }
  });
}

// Create cache_permission_map table
function createCachePermissionMapTable() {
  log('Checking/creating cache_permission_map table');
  db.run(`
    CREATE TABLE IF NOT EXISTS cache_permission_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key VARCHAR(100) NOT NULL UNIQUE,
      permissions TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, function(err) {
    if (err) {
      log(`Error creating cache_permission_map table: ${err.message}`, true);
    } else {
      log('Cache_permission_map table created or already exists');
    }
  });
}

// Populate default data for lookup tables
function populateDefaultData() {
  // Default actions
  const defaultActions = [
    { name: 'create', description: 'Create a resource' },
    { name: 'read', description: 'Read/view a resource' },
    { name: 'update', description: 'Update a resource' },
    { name: 'delete', description: 'Delete a resource' },
    { name: 'list', description: 'List multiple resources' },
    { name: 'manage', description: 'Full management of a resource' },
    { name: 'approve', description: 'Approve a resource' },
    { name: 'reject', description: 'Reject a resource' },
    { name: 'export', description: 'Export a resource' },
    { name: 'import', description: 'Import a resource' }
  ];
  
  // Default resources
  const defaultResources = [
    { name: 'user', description: 'User accounts' },
    { name: 'role', description: 'User roles' },
    { name: 'group', description: 'User groups' },
    { name: 'permission', description: 'Permissions' },
    { name: 'setting', description: 'System settings' },
    { name: 'report', description: 'Reports' },
    { name: 'content', description: 'Content items' },
    { name: 'file', description: 'Files and documents' },
    { name: 'dashboard', description: 'Dashboards' },
    { name: 'log', description: 'System logs' }
  ];
  
  // Insert actions
  log('Populating default actions...');
  const actionStmt = db.prepare('INSERT OR IGNORE INTO actions (name, description) VALUES (?, ?)');
  
  let actionsProcessed = 0;
  defaultActions.forEach((action, index) => {
    actionStmt.run(action.name, action.description, err => {
      if (err && debugMode) {
        log(`Error inserting action ${action.name}: ${err.message}`, true);
      }
      
      actionsProcessed++;
      if (actionsProcessed === defaultActions.length) {
        // All actions processed, finalize the statement
        actionStmt.finalize(err => {
          if (err) {
            log(`Error finalizing action statement: ${err.message}`, true);
          } else {
            log('Default actions populated');
            populateResources(); // Continue with resources after actions are done
          }
        });
      }
    });
  });
  
  // Function to insert resources after actions are processed
  function populateResources() {
    log('Populating default resources...');
    const resourceStmt = db.prepare('INSERT OR IGNORE INTO resources (name, description) VALUES (?, ?)');
    
    let resourcesProcessed = 0;
    defaultResources.forEach((resource, index) => {
      resourceStmt.run(resource.name, resource.description, err => {
        if (err && debugMode) {
          log(`Error inserting resource ${resource.name}: ${err.message}`, true);
        }
        
        resourcesProcessed++;
        if (resourcesProcessed === defaultResources.length) {
          // All resources processed, finalize the statement
          resourceStmt.finalize(err => {
            if (err) {
              log(`Error finalizing resource statement: ${err.message}`, true);
            } else {
              log('Default resources populated');
              
              // After all operations are complete, close the database
              db.close(err => {
                if (err) {
                  log(`Error closing database: ${err.message}`, true);
                } else {
                  log('Database connection closed');
                }
                logStream.end();
              });
            }
          });
        }
      });
    });
  }
  
  // If no actions to process, directly populate resources
  if (defaultActions.length === 0) {
    actionStmt.finalize();
    populateResources();
  }
}

// Utility function for logging errors
function logError(operation) {
  return function(err) {
    if (err && debugMode) {
      log(`Error ${operation}: ${err.message}`, true);
    }
  };
}