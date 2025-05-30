# Schema Alignment Audit Tool

## Overview

The Schema Alignment Audit Tool is a comprehensive utility for identifying mismatches between:
1. Actual SQLite database tables, columns, and constraints
2. TypeORM entity definitions and decorators
3. TypeORM migration scripts

This tool generates detailed reports to help you identify and fix schema alignment issues that can cause runtime errors and data integrity problems.

## Features

- **Complete Database Schema Extraction**: Extracts detailed information about tables, columns, constraints, and indexes from SQLite databases
- **TypeORM Entity Parsing**: Analyzes TypeORM entity decorators to understand the intended schema
- **Migration Script Analysis**: Examines TypeORM migration scripts to track schema evolution
- **Barrel File Detection**: Intelligently detects and skips barrel files (re-export files) that don't contain actual entity definitions
- **File Processing Statistics**: Tracks and reports on processed files, skipped files, and barrel files
- **Comprehensive Mismatch Detection**:
  - Tables with missing entity definitions
  - Entities with missing database tables
  - Column type mismatches
  - Nullability conflicts
  - Missing/extra columns
  - Foreign key constraint issues
  - Primary key mismatches
- **JSON and Text Reporting**: Generates detailed reports in both formats
- **SQL Fix Generation**: Optional capability to generate SQL statements to fix detected issues
- **Debug Mode**: Detailed logging for troubleshooting

## Requirements

- Python 3.6 or higher
- SQLite database
- TypeORM entity and migration files

## Installation

Clone the repository and ensure you have Python installed:

```bash
pip install -r requirements.txt
```

## Usage

```bash
python schema_alignment_audit.py [--config CONFIG_FILE] [--output OUTPUT_DIR] [--debug] [--fix]
```

### Options

- `--config CONFIG_FILE`: Path to configuration file (default: `config.json`)
- `--output OUTPUT_DIR`: Directory for output reports (default: `./audit_reports`)
- `--debug`: Enable debug mode for detailed logging
- `--fix`: Generate SQL statements to fix identified mismatches (use with caution!)

### Example

```bash
python schema_alignment_audit.py --config ./my-config.json --output ./reports --debug
```

## Configuration

The tool uses the same configuration file as the database tools:

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

## Output Files

The tool generates several output files in the specified output directory:

1. **Log File**: `schema_audit_YYYYMMDD_HHMMSS.log` - Detailed log of the audit process
2. **JSON Report**: `schema_audit_report_YYYYMMDD_HHMMSS.json` - Comprehensive JSON report with all findings
3. **Text Summary**: `schema_audit_summary_YYYYMMDD_HHMMSS.txt` - Human-readable summary of findings
4. **Fix SQL** (optional): `schema_fix_YYYYMMDD_HHMMSS.sql` - SQL statements to fix identified issues

## Report Structure

The JSON report includes:

- **Timestamp**: When the audit was run
- **Database Information**: Path and table count
- **Entity Summary**: List of entities and their table mappings
- **Migration Summary**: List of analyzed migration files
- **Mismatches**: Detailed list of all identified schema mismatches:
  - Type of mismatch
  - Affected table and column
  - Expected vs. actual values
  - Detailed description

## Fix SQL Generation

When run with the `--fix` flag, the tool will generate SQL statements to fix the identified issues. These may include:

- `CREATE TABLE` statements for missing tables
- `ALTER TABLE ADD COLUMN` statements for missing columns
- Comments with guidance for complex issues like type changes

**IMPORTANT**: Review all generated SQL carefully before executing it on your database. It's recommended to back up your database first.

## Best Practices

1. Run the tool after major schema changes
2. Review all mismatches and understand their implications
3. Backup your database before applying any automatically generated fixes
4. Keep entity definitions in sync with database schema
5. Follow a consistent naming convention for tables and columns

## Common Issues and Solutions

### Missing Tables

Tables missing from the database but defined in TypeORM entities may indicate:
- Migrations not applied correctly
- Manual database changes
- Environment-specific schemas

**Solution**: Run the generated SQL to create the missing tables, or ensure migrations are properly applied.

### Type Mismatches

Type mismatches often occur due to:
- Manual schema changes
- SQLite's flexible typing system
- TypeORM type mapping inconsistencies

**Solution**: SQLite doesn't support direct `ALTER TABLE MODIFY COLUMN` commands. The fix requires creating a new table with the correct schema, copying data, and dropping the old table.

### Foreign Key Constraint Issues

Foreign key constraint mismatches usually indicate:
- Incomplete entity relationship definitions
- Manual schema modifications
- SQLite-specific limitations

**Solution**: Ensure relationship decorators in entity files properly use `@JoinColumn` with correct column names.

## Troubleshooting

- **Connection Errors**: Verify the database path in configuration is correct
- **Entity Parsing Errors**: Ensure entity files follow standard TypeORM patterns
- **No Mismatches Found but Issues Persist**: Check for case sensitivity issues in table/column names

## Author

Claude Operator

## License

MIT 