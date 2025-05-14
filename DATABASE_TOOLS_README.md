# Database Management Tools

This directory contains a set of tools for managing and validating the SQLite database used by the NestJS/Angular application.

## Tools Overview

### fix-database.js

A JavaScript utility that creates, fixes, and updates the database schema to ensure it meets the application requirements.

**Features:**
- Creates the database file if it doesn't exist
- Creates all required tables with proper schemas
- Adds missing columns to existing tables 
- Creates indexes for efficient queries
- Adds foreign key constraints for data integrity
- Populates default data for actions and resources
- Creates automatic backups before modifications
- Logs all operations to both console and a log file
- Configurable behavior via config.json

**Usage:**
```bash
node fix-database.js
```

### check-db.js

A JavaScript utility that examines the current database structure and provides detailed information about tables, columns, indexes, and row counts.

**Features:**
- Lists all tables in the database
- Shows detailed information about each table's columns and their data types
- Displays indexes for each table
- Shows row counts for each table
- Checks foreign key constraints and identifies violations
- Validates integrity of the database
- Verifies presence of expected tables
- Displays sample data in debug mode
- Logs all output to both console and a log file
- Configurable behavior via config.json

**Usage:**
```bash
node check-db.js
```

## Configuration (config.json)

Both tools use the same configuration file with the following options:

```json
{
  "debug_mode": true,
  "log_directory": "logs",
  "connection_timeout": 5000,
  "database": {
    "path": "./src/database/database.sqlite",
    "backup_directory": "./backup",
    "enable_foreign_keys": true,
    "create_missing_tables": true
  },
  "validation": {
    "enable_auto_fix": false,
    "check_on_startup": true
  }
}
```

### Configuration Options

| Option | Description |
|--------|-------------|
| `debug_mode` | When true, displays additional debugging information |
| `log_directory` | Directory where log files will be stored |
| `connection_timeout` | Timeout in milliseconds for database connection |
| `database.path` | Path to the SQLite database file |
| `database.backup_directory` | Directory where database backups will be stored |
| `database.enable_foreign_keys` | When true, enables foreign key constraints |
| `database.create_missing_tables` | When true, automatically creates missing tables |
| `validation.enable_auto_fix` | When true, automatically fixes validation issues |
| `validation.check_on_startup` | When true, runs validation checks at application startup |

## Database Schema

The database includes the following tables:

### Core Tables

1. **permission**
   - Stores individual permissions that can be assigned to users and roles
   - Primary columns: `id`, `name`, `resource_name`, `action`
   - Unique constraint on `resource_name, action` combination

2. **roles**
   - Defines user roles with description and hierarchy
   - Primary columns: `id`, `name`, `description`, `parent_id`
   - Foreign key: `parent_id` references `roles(id)`

3. **users**
   - Stores user account information
   - Primary columns: `id`, `email`, `password`, `first_name`, `last_name`
   - Flags: `is_active`, `is_verified`

4. **groups**
   - Defines user groups
   - Primary columns: `id`, `name`, `description`
   - Flag: `is_system_group`

### Relationship Tables

5. **user_permission**
   - Maps permissions to specific users
   - Primary columns: `id`, `user_id`, `permission_id`, `granted`
   - Foreign keys: `user_id` references `users(id)`, `permission_id` references `permission(id)`
   - Unique constraint on `user_id, permission_id` combination

6. **role_permissions**
   - Maps permissions to roles
   - Primary columns: `id`, `role_id`, `permission_id`, `granted`
   - Foreign keys: `role_id` references `roles(id)`, `permission_id` references `permission(id)`
   - Unique constraint on `role_id, permission_id` combination

7. **user_groups**
   - Maps users to groups
   - Primary columns: `id`, `user_id`, `group_id`
   - Foreign keys: `user_id` references `users(id)`, `group_id` references `groups(id)`
   - Unique constraint on `user_id, group_id` combination

8. **user_roles**
   - Maps users to roles
   - Primary columns: `id`, `user_id`, `role_id`
   - Foreign keys: `user_id` references `users(id)`, `role_id` references `roles(id)`
   - Unique constraint on `user_id, role_id` combination

### UI and API Tables

9. **api_endpoints**
   - Contains API endpoint information with required permissions
   - Primary columns: `id`, `path`, `method`, `controller`, `action`, `required_permissions`
   - Unique constraint on `path, method` combination

10. **frontend_routes**
    - Contains frontend routes with required permissions
    - Primary columns: `id`, `path`, `component`, `required_permissions`

11. **ui_components**
    - Contains UI component information with required permissions
    - Primary columns: `id`, `name`, `selector`, `required_permissions`

### Lookup Tables

12. **actions**
    - Predefined actions that can be performed on resources
    - Primary columns: `id`, `name`, `description`
    - Default values include: create, read, update, delete, list, manage, etc.

13. **resources**
    - Predefined resources that actions can be performed on
    - Primary columns: `id`, `name`, `description`
    - Default values include: user, role, group, permission, etc.

### Cache Tables

14. **cache_permission_map**
    - Caches permission data for rapid access
    - Primary columns: `id`, `key`, `permissions`, `metadata`

## Directory Structure

```
/
├── fix-database.js            # Database schema creation/repair tool
├── check-db.js                # Database inspection tool
├── config.json                # Configuration for database tools
├── DATABASE_TOOLS_README.md   # This documentation file
├── logs/                      # Log files directory
│   ├── database_check_*.log   # Check database log files
│   └── database_fix_*.log     # Fix database log files
├── backup/                    # Database backup directory
│   └── database_backup_*.sqlite # Backup files
└── src/
    └── database/              # Database files
        └── database.sqlite    # SQLite database file
```

## Logging

Both tools create log files with timestamps in the format:
- `logs/database_fix_YYYY-MM-DDTHH_MM_SS.log` (for fix-database.js)
- `logs/database_check_YYYY-MM-DDTHH_MM_SS.log` (for check-db.js)

These logs contain all operations performed and any errors encountered. The logs include:
- Table creation/modification operations
- Index creation
- Foreign key constraints
- Default data population
- Error messages and warnings
- Database validation results

## Error Handling

The tools include error handling for:
- Missing database file
- SQL query errors
- Table creation failures
- Connection issues
- Timeout handling
- Foreign key constraint violations
- Index creation errors
- Directory creation failures
- Permission issues

Error messages are displayed in the console and written to the log file.

## Backup Mechanism

The fix-database.js tool creates automatic backups of the database before making any changes:
- Backups are stored in the configured backup directory
- Timestamps are added to filenames for easy identification
- Backup is verified before proceeding with modifications

## Default Data

The fix-database.js tool populates default data for lookup tables:

### Default Actions
- create: Create a resource
- read: Read/view a resource
- update: Update a resource
- delete: Delete a resource
- list: List multiple resources
- manage: Full management of a resource
- approve: Approve a resource
- reject: Reject a resource
- export: Export a resource
- import: Import a resource

### Default Resources
- user: User accounts
- role: User roles
- group: User groups
- permission: Permissions
- setting: System settings
- report: Reports
- content: Content items
- file: Files and documents
- dashboard: Dashboards
- log: System logs

## Dependencies

- Node.js 12+ 
- sqlite3 npm package

To install dependencies:
```bash
npm install sqlite3
```

## Common Issues and Solutions

### Database Locked
If you encounter a "database is locked" error, it usually means another process is using the database. Wait a few moments and try again.

### Foreign Key Constraints Failed
Foreign key constraint failures happen when you try to insert data that references non-existent records. Check the log file for details about which constraints failed.

### Missing Tables After Fix
If tables are missing after running fix-database.js, check the log file for errors and verify that `database.create_missing_tables` is set to `true` in config.json.

### Slow Database Operations
For large databases, operations may be slow. Consider:
1. Reducing debug output by setting `debug_mode: false`
2. Optimizing queries in the application
3. Adding appropriate indexes to tables that are queried frequently

## Best Practices

1. Always run check-db.js after making changes with fix-database.js
2. Review log files for errors after running the tools
3. Back up the database regularly (automatic backups occur with fix-database.js)
4. Keep the config.json file up to date with the application requirements
5. Set `debug_mode: false` in production for better performance
6. Run database tools during application deployment or startup, not during active use 