#!/usr/bin/env python
import os
import sys
import json
import sqlite3
import re
import argparse
from datetime import datetime
import logging
import glob

# Configure logging
log_dir = 'logs'
if not os.path.exists(log_dir):
    os.makedirs(log_dir)

log_file = os.path.join(log_dir, f"role_permission_fix_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(log_file)
    ]
)
logger = logging.getLogger(__name__)

class RolePermissionsFixer:
    """Utility to fix the role permissions table schema mismatch."""
    
    def __init__(self, config_path, backup=True, apply=False, debug=False):
        """Initialize the fixer with configuration settings."""
        self.config_path = config_path
        self.backup = backup
        self.apply = apply
        self.debug = debug
        self.config = {}
        self.conn = None
        self.cursor = None
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        if debug:
            logger.setLevel(logging.DEBUG)
        
    def run(self):
        """Execute the fix process."""
        logger.info("Starting Role Permissions Schema Fix")
        logger.info(f"Log file: {log_file}")
        
        try:
            self._load_config()
            self._find_database()
            self._connect_db()
            self._backup_db()
            self._analyze_schema()
            self._generate_fix_script()
            
            if self.apply:
                self._apply_fixes()
            
            logger.info("Role Permissions Schema Fix completed successfully")
            
        except Exception as e:
            logger.error(f"Error during fix process: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return False
        finally:
            self._close_db()
        
        return True
    
    def _load_config(self):
        """Load configuration from JSON file."""
        try:
            with open(self.config_path, 'r') as f:
                self.config = json.load(f)
            logger.info(f"Configuration loaded from {self.config_path}")
            
            if self.debug:
                logger.debug(f"Configuration: {json.dumps(self.config, indent=2)}")
        except Exception as e:
            logger.error(f"Failed to load configuration: {str(e)}")
            raise
    
    def _find_database(self):
        """Find the SQLite database file."""
        db_path = self.config.get('database', {}).get('path', './src/database/database.sqlite')
        
        # Check if the path is valid
        if os.path.exists(db_path) and os.path.isfile(db_path):
            logger.info(f"Found database at configured path: {db_path}")
            self.db_path = db_path
            return
        
        # Try to find database in common locations
        potential_paths = [
            './angular/backend/src/database/database.sqlite',
            './src/database/database.sqlite',
            './angular/backend/db.sqlite',
            './db.sqlite'
        ]
        
        # Also look for any .sqlite files
        sqlite_files = glob.glob('./**/*.sqlite', recursive=True)
        potential_paths.extend(sqlite_files)
        
        for path in potential_paths:
            if os.path.exists(path) and os.path.isfile(path):
                logger.info(f"Found database at: {path}")
                self.db_path = path
                return
        
        # If we get here, we couldn't find the database
        logger.error("Could not find database file in any expected location")
        raise FileNotFoundError("Database file not found in any expected location")
    
    def _connect_db(self):
        """Connect to the SQLite database."""
        try:
            logger.info(f"Connecting to database at {self.db_path}")
            
            self.conn = sqlite3.connect(self.db_path)
            self.conn.row_factory = sqlite3.Row
            self.cursor = self.conn.cursor()
            
            # Enable foreign keys
            self.cursor.execute("PRAGMA foreign_keys = ON")
            
            # Get database size
            db_size = os.path.getsize(self.db_path) / (1024 * 1024)  # Size in MB
            logger.info(f"Connected to database ({db_size:.2f} MB)")
            
            # Log database version
            self.cursor.execute("SELECT sqlite_version()")
            version = self.cursor.fetchone()[0]
            logger.info(f"SQLite version: {version}")
            
            # Count tables
            self.cursor.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            table_count = self.cursor.fetchone()[0]
            logger.info(f"Database contains {table_count} tables")
        except Exception as e:
            logger.error(f"Failed to connect to database: {str(e)}")
            raise
    
    def _backup_db(self):
        """Create a backup of the database if backup is enabled."""
        if not self.backup:
            logger.info("Database backup skipped")
            return
        
        try:
            backup_dir = self.config.get('database', {}).get('backup_directory', './backup')
            
            if not os.path.exists(backup_dir):
                os.makedirs(backup_dir)
            
            backup_path = os.path.join(backup_dir, f"db_backup_{self.timestamp}.sqlite")
            
            # Create backup
            backup_conn = sqlite3.connect(backup_path)
            self.conn.backup(backup_conn)
            backup_conn.close()
            
            # Get backup size
            backup_size = os.path.getsize(backup_path) / (1024 * 1024)  # Size in MB
            
            logger.info(f"Database backup created at {backup_path} ({backup_size:.2f} MB)")
        except Exception as e:
            logger.error(f"Failed to create database backup: {str(e)}")
            raise
    
    def _analyze_schema(self):
        """Analyze the current database schema to identify role permissions issues."""
        logger.info("Analyzing database schema for role permissions issues")
        
        # Check for both 'permission' and 'permissions' tables
        self.cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND (name='permission' OR name='permissions')")
        permission_tables = [row['name'] for row in self.cursor.fetchall()]
        
        if 'permission' in permission_tables and 'permissions' in permission_tables:
            logger.warning("Both 'permission' and 'permissions' tables exist, which may cause conflicts")
        elif 'permission' in permission_tables:
            logger.info("Found 'permission' table (singular)")
        elif 'permissions' in permission_tables:
            logger.info("Found 'permissions' table (plural)")
        else:
            logger.error("Neither 'permission' nor 'permissions' table found")
            raise Exception("Permission table not found in the database")
        
        # Get the full list of tables
        self.cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        all_tables = [row['name'] for row in self.cursor.fetchall()]
        logger.debug(f"All tables: {', '.join(all_tables)}")
        
        # Check role_permissions table
        role_permissions_exists = 'role_permissions' in all_tables
        if not role_permissions_exists:
            logger.error("role_permissions table not found in database")
            raise Exception("role_permissions table does not exist in the database")
        
        # Get role_permissions table schema
        self.cursor.execute("PRAGMA table_info(role_permissions)")
        columns = {row['name']: {
            'type': row['type'],
            'notnull': row['notnull'],
            'dflt_value': row['dflt_value'],
            'pk': row['pk']
        } for row in self.cursor.fetchall()}
        
        logger.info(f"role_permissions table columns: {json.dumps(columns, indent=2)}")
        
        # Check foreign keys
        self.cursor.execute("PRAGMA foreign_key_list(role_permissions)")
        foreign_keys = [dict(row) for row in self.cursor.fetchall()]
        
        logger.info(f"role_permissions foreign keys: {json.dumps(foreign_keys, indent=2)}")
        
        # Find foreign key issues
        fk_issues = []
        for fk in foreign_keys:
            target_table = fk['table']
            
            # Check if target table exists
            if target_table not in all_tables:
                fk_issues.append(f"Foreign key references non-existent table: {target_table}")
                continue
            
            # For permission_id column, check if it references 'permission' or 'permissions'
            if fk['from'] == 'permission_id':
                if target_table == 'permission' and 'permissions' in all_tables:
                    fk_issues.append(f"permission_id references singular 'permission' table instead of plural 'permissions'")
                elif target_table == 'permissions' and 'permission' in all_tables and 'permissions' not in all_tables:
                    fk_issues.append(f"permission_id references plural 'permissions' table but only singular 'permission' exists")
        
        if fk_issues:
            logger.warning("Foreign key issues found:")
            for issue in fk_issues:
                logger.warning(f" - {issue}")
        
        # Store schema info for fix generation
        self.role_permissions_schema = {
            'exists': role_permissions_exists,
            'columns': columns,
            'foreign_keys': foreign_keys,
            'fk_issues': fk_issues
        }
        
        # Check entity tables
        self.related_tables = {
            'roles': 'roles' in all_tables,
            'permission': 'permission' in all_tables,
            'permissions': 'permissions' in all_tables,
            'user_permission': 'user_permission' in all_tables,
            'user_permissions': 'user_permissions' in all_tables,
            'group_permission': 'group_permission' in all_tables,
            'group_permissions': 'group_permissions' in all_tables
        }
        
        logger.info(f"Related tables: {json.dumps(self.related_tables, indent=2)}")
        
        # Check for the critical issue: 'permission' exists but code looks for 'permissions'
        if self.related_tables['permission'] and not self.related_tables['permissions']:
            logger.warning("CRITICAL ISSUE: 'permission' table exists (singular) but code likely looks for 'permissions' (plural)")
        
        # Check for both singular and plural versions
        for base in ['user_permission', 'group_permission']:
            plural = f"{base}s"
            if self.related_tables[base] and self.related_tables[plural]:
                logger.warning(f"ISSUE: Both {base} and {plural} tables exist, which may cause conflicts")
        
        # Check for columns in permission table(s)
        for table_name in ['permission', 'permissions']:
            if self.related_tables[table_name]:
                self.cursor.execute(f"PRAGMA table_info({table_name})")
                columns = {row['name']: {
                    'type': row['type'],
                    'notnull': row['notnull'],
                    'dflt_value': row['dflt_value'],
                    'pk': row['pk']
                } for row in self.cursor.fetchall()}
                
                # Check for resourceName and action columns
                if 'resource_name' not in columns:
                    logger.warning(f"ISSUE: '{table_name}' table is missing 'resource_name' column")
                
                if 'action' not in columns:
                    logger.warning(f"ISSUE: '{table_name}' table is missing 'action' column")
                
                logger.info(f"{table_name} table columns: {json.dumps(columns, indent=2)}")
    
    def _generate_fix_script(self):
        """Generate SQL script to fix the role permissions issues."""
        logger.info("Generating fix script for role permissions issues")
        
        sql_statements = []
        
        # Add transaction start
        sql_statements.append("BEGIN TRANSACTION;")
        
        # Check if we need to create permission table with the correct name
        if self.related_tables['permission'] and not self.related_tables['permissions']:
            logger.info("Need to rename 'permission' table to 'permissions'")
            
            # Create a new 'permissions' table with the same structure
            self.cursor.execute("PRAGMA table_info(permission)")
            permission_columns = [dict(row) for row in self.cursor.fetchall()]
            
            # Generate CREATE TABLE statement for permissions
            columns_sql = []
            for col in permission_columns:
                column_def = f"{col['name']} {col['type']}"
                if col['notnull']:
                    column_def += " NOT NULL"
                if col['dflt_value'] is not None:
                    column_def += f" DEFAULT {col['dflt_value']}"
                if col['pk']:
                    column_def += " PRIMARY KEY"
                columns_sql.append(column_def)
            
            # Create the new table
            create_permissions_sql = f"CREATE TABLE permissions (\n  {',\n  '.join(columns_sql)}\n);"
            sql_statements.append(create_permissions_sql)
            
            # Copy data from permission to permissions
            sql_statements.append("INSERT INTO permissions SELECT * FROM permission;")
            
            # Check for missing columns in the permission table
            missing_columns = []
            if 'resource_name' not in [col['name'] for col in permission_columns]:
                missing_columns.append(("resource_name", "VARCHAR"))
            
            if 'action' not in [col['name'] for col in permission_columns]:
                missing_columns.append(("action", "VARCHAR"))
            
            # Add missing columns and extract values from name
            for col_name, col_type in missing_columns:
                sql_statements.append(f"ALTER TABLE permissions ADD COLUMN {col_name} {col_type};")
            
            if ("resource_name", "VARCHAR") in missing_columns:
                sql_statements.append("""
UPDATE permissions
SET resource_name = SUBSTR(name, 1, INSTR(name, ':') - 1)
WHERE resource_name IS NULL AND INSTR(name, ':') > 0;
""")
            
            if ("action", "VARCHAR") in missing_columns:
                sql_statements.append("""
UPDATE permissions
SET action = SUBSTR(name, INSTR(name, ':') + 1)
WHERE action IS NULL AND INSTR(name, ':') > 0;
""")
            
            # Create indexes for better performance
            sql_statements.append("CREATE INDEX IF NOT EXISTS idx_permissions_name ON permissions(name);")
            sql_statements.append("CREATE INDEX IF NOT EXISTS idx_permissions_resource_name ON permissions(resource_name);")
            sql_statements.append("CREATE INDEX IF NOT EXISTS idx_permissions_action ON permissions(action);")
            
            # Update foreign keys to point to permissions instead of permission
            # This may require dropping and recreating tables with foreign keys to permission
            
            # For role_permissions table
            sql_statements.append("""
-- Drop existing role_permissions table
DROP TABLE IF EXISTS role_permissions_temp;

-- Create a new role_permissions table with updated foreign key
CREATE TABLE role_permissions_temp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  granted BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE (role_id, permission_id)
);

-- Copy data from original table
INSERT INTO role_permissions_temp
SELECT * FROM role_permissions;

-- Drop original table
DROP TABLE role_permissions;

-- Rename temp table to original name
ALTER TABLE role_permissions_temp RENAME TO role_permissions;

-- Recreate indexes
CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);
""")
            
            # For user_permission table
            if self.related_tables['user_permission']:
                sql_statements.append("""
-- Drop existing user_permission table
DROP TABLE IF EXISTS user_permission_temp;

-- Create a new user_permission table with updated foreign key
CREATE TABLE user_permission_temp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  granted BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE (user_id, permission_id)
);

-- Copy data from original table
INSERT INTO user_permission_temp
SELECT * FROM user_permission;

-- Drop original table
DROP TABLE user_permission;

-- Rename temp table to original name
ALTER TABLE user_permission_temp RENAME TO user_permission;

-- Recreate indexes
CREATE INDEX idx_user_permission_user_id ON user_permission(user_id);
CREATE INDEX idx_user_permission_permission_id ON user_permission(permission_id);
""")
            
            # For group_permission table
            if self.related_tables['group_permission']:
                sql_statements.append("""
-- Drop existing group_permission table
DROP TABLE IF EXISTS group_permission_temp;

-- Create a new group_permission table with updated foreign key
CREATE TABLE group_permission_temp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  granted BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE (group_id, permission_id)
);

-- Copy data from original table
INSERT INTO group_permission_temp
SELECT * FROM group_permission;

-- Drop original table
DROP TABLE group_permission;

-- Rename temp table to original name
ALTER TABLE group_permission_temp RENAME TO group_permission;

-- Recreate indexes
CREATE INDEX idx_group_permission_group_id ON group_permission(group_id);
CREATE INDEX idx_group_permission_permission_id ON group_permission(permission_id);
""")
        
        # If table already exists but is missing columns
        elif self.related_tables['permissions']:
            # Check for missing columns in the permissions table
            self.cursor.execute("PRAGMA table_info(permissions)")
            permissions_columns = {row['name'] for row in self.cursor.fetchall()}
            
            if 'resource_name' not in permissions_columns:
                sql_statements.append("ALTER TABLE permissions ADD COLUMN resource_name VARCHAR;")
                sql_statements.append("""
UPDATE permissions
SET resource_name = SUBSTR(name, 1, INSTR(name, ':') - 1)
WHERE resource_name IS NULL AND INSTR(name, ':') > 0;
""")
            
            if 'action' not in permissions_columns:
                sql_statements.append("ALTER TABLE permissions ADD COLUMN action VARCHAR;")
                sql_statements.append("""
UPDATE permissions
SET action = SUBSTR(name, INSTR(name, ':') + 1)
WHERE action IS NULL AND INSTR(name, ':') > 0;
""")
            
            # Create indexes for better performance
            sql_statements.append("CREATE INDEX IF NOT EXISTS idx_permissions_name ON permissions(name);")
            sql_statements.append("CREATE INDEX IF NOT EXISTS idx_permissions_resource_name ON permissions(resource_name);")
            sql_statements.append("CREATE INDEX IF NOT EXISTS idx_permissions_action ON permissions(action);")
        
        # Add transaction commit
        sql_statements.append("\nCOMMIT;")
        
        # Write the SQL script to a file
        script_path = f"fix_role_permissions_{self.timestamp}.sql"
        with open(script_path, 'w') as f:
            f.write("-- Role Permissions Schema Fix Script\n")
            f.write(f"-- Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            f.write("\n".join(sql_statements))
        
        logger.info(f"Fix script generated at {script_path}")
        self.fix_script_path = script_path
    
    def _apply_fixes(self):
        """Apply the generated fixes to the database."""
        if not self.apply:
            logger.info("Fix application skipped (--apply not specified)")
            return
        
        try:
            logger.info("Applying fixes to database")
            
            # Read the SQL script
            with open(self.fix_script_path, 'r') as f:
                script = f.read()
            
            # Execute the script
            self.conn.executescript(script)
            
            # Verify fixes
            self._verify_fixes()
            
            logger.info("Fixes applied successfully")
        except Exception as e:
            logger.error(f"Failed to apply fixes: {str(e)}")
            self.conn.rollback()
            raise
    
    def _verify_fixes(self):
        """Verify that the fixes were applied correctly."""
        logger.info("Verifying fixes")
        
        # Check if permissions table exists
        self.cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='permissions'")
        permissions_exists = self.cursor.fetchone() is not None
        
        if not permissions_exists:
            logger.error("Verification failed: permissions table does not exist")
            return False
        
        # Check if permissions table has resource_name and action columns
        self.cursor.execute("PRAGMA table_info(permissions)")
        columns = {row['name'] for row in self.cursor.fetchall()}
        
        if 'resource_name' not in columns:
            logger.error("Verification failed: permissions table is missing resource_name column")
            return False
        
        if 'action' not in columns:
            logger.error("Verification failed: permissions table is missing action column")
            return False
        
        # Check if data was copied correctly
        self.cursor.execute("SELECT COUNT(*) FROM permissions")
        count = self.cursor.fetchone()[0]
        
        if count == 0:
            logger.warning("Verification warning: permissions table is empty")
        
        # Check role_permissions foreign keys
        self.cursor.execute("PRAGMA foreign_key_list(role_permissions)")
        foreign_keys = {(fk['from'], fk['table']) for fk in self.cursor.fetchall()}
        
        if ('permission_id', 'permissions') not in foreign_keys:
            logger.error("Verification failed: role_permissions does not reference permissions table")
            return False
        
        logger.info("Verification passed: fixes were applied correctly")
        return True
    
    def _close_db(self):
        """Close the database connection."""
        if self.conn:
            self.conn.close()
            logger.info("Database connection closed")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fix role permissions schema issues in TypeORM SQLite database")
    parser.add_argument("--config", default="config.json", help="Path to configuration file")
    parser.add_argument("--no-backup", action="store_true", help="Skip database backup")
    parser.add_argument("--apply", action="store_true", help="Apply fixes to the database")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    
    args = parser.parse_args()
    
    fixer = RolePermissionsFixer(args.config, not args.no_backup, args.apply, args.debug)
    success = fixer.run()
    
    sys.exit(0 if success else 1) 