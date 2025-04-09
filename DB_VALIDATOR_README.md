# Database Schema Validator

A comprehensive tool for validating and synchronizing database schema with TypeORM entity definitions in your Angular application.

## Overview

The Database Schema Validator helps ensure that your database schema matches the TypeORM entity definitions in your codebase. This is particularly important when using migrations or when making changes to entity definitions.

## Features

- **Schema Validation**: Compare your database schema with TypeORM entity definitions
- **Schema Extraction**: Extract schema information from TypeORM entity files
- **Schema Synchronization**: Update your database schema to match entity definitions
- **Database Backup**: Create backups of your database before making changes
- **Comprehensive Logging**: Track all validation and synchronization activities
- **Easy Integration**: Use as a standalone tool or integrate into your CI/CD pipeline

## Installation

No installation required! The tool is designed to work with Python 3.6+ and uses only standard library modules.

## Usage

The validator provides several commands to manage your database schema:

```bash
# Show help
python db_schema_validator.py --help

# Validate the database schema
python db_schema_validator.py validate

# Create a backup of the database
python db_schema_validator.py backup

# Extract schema from TypeORM entities
python db_schema_validator.py extract --output my_schema.json

# Check what changes would be made to synchronize the schema
python db_schema_validator.py sync --dry-run

# Apply schema changes to the database (with backup)
python db_schema_validator.py sync --with-backup

# Full workflow: backup, validate, and synchronize
python db_schema_validator.py full-sync
```

## Configuration

The validator can be configured using a JSON configuration file located at `angular/scripts/db_validator_config.json`. Here's an example configuration:

```json
{
  "entities_path": "angular/backend/src/modules",
  "db_path": "angular/backend/data/dev.sqlite",
  "schema_file": "angular/scripts/expected_schema.json",
  "debug": false,
  "ignore_tables": ["migrations", "typeorm_metadata"],
  "ignore_columns": {
    "*": ["created_at", "updated_at"]
  },
  "sync_options": {
    "auto_sync": false,
    "backup_before_sync": true
  }
}
```

## Workflow Example

Here's a typical workflow for using the Database Schema Validator:

1. **Development Phase**
   - Make changes to your TypeORM entities
   - Extract the schema: `python db_schema_validator.py extract`
   - Validate the schema: `python db_schema_validator.py validate`
   - If differences are found, review and fix them

2. **Deployment Phase**
   - Backup the database: `python db_schema_validator.py backup`
   - Check for schema differences: `python db_schema_validator.py validate`
   - Apply schema changes: `python db_schema_validator.py sync --with-backup`

3. **CI/CD Integration**
   - Add schema validation to your CI/CD pipeline
   - Fail the build if schema validation errors are found
   - Optionally, automatically fix schema issues in development environments

## Limitations

- SQLite has limited support for schema changes. Some differences require manual intervention.
- Column type changes and primary key modifications often require a table rebuild.
- The tool is designed for development and staging environments. Use with caution in production.

## Project Structure

```
angular/scripts/
├── db_schema_validator.py   # Main schema validator implementation
├── db_backup.py             # Database backup utility
├── db_tools.py              # Unified CLI for all tools
├── run_schema_validator.py  # Runner script for the validator
├── db_validator_config.json # Configuration file
└── README_DB_VALIDATOR.md   # Detailed documentation
```

## Troubleshooting

### Common Issues

1. **Database file not found**
   - Check the `db_path` in your configuration file
   - Ensure the database file exists and is accessible

2. **Entity files not recognized**
   - Verify the `entities_path` in your configuration
   - Check that your entity files follow TypeORM conventions

3. **Schema synchronization errors**
   - SQLite has limitations on schema modifications
   - Consider using TypeORM migrations for complex changes

### Logs

The validator creates detailed log files for each run:
- Schema validation logs: `schema_validator_*.log`
- Database backup logs: `db_backup_*.log`
- Combined tools logs: `db_tools_*.log`

## Contributing

Contributions are welcome! Feel free to submit pull requests or open issues for enhancements and bug fixes.

## License

MIT License

---

For more detailed information about the validator, see the documentation in `angular/scripts/README_DB_VALIDATOR.md`. 