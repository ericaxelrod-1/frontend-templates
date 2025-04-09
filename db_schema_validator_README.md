# Database Schema Validator and Synchronizer

This Python script helps validate and synchronize your database schema with the expected structure defined in your TypeORM entities. It's designed to identify inconsistencies between your code and database, and optionally fix them.

## Features

- **Schema Validation**: Checks if your database structure matches the expected schema
- **Issue Detection**: Identifies missing tables, columns, constraints, and indexes
- **Reports**: Generates detailed validation reports for reference
- **Fix Mode**: Can automatically fix schema issues (use with caution)
- **Synchronization**: Can trigger the TypeORM schema synchronization
- **Support**: Works with SQLite databases (PostgreSQL support coming soon)

## Requirements

- Python 3.6+
- SQLite3 (included in Python standard library)
- TypeORM-based backend application

## Installation

No installation needed. Just ensure you have Python 3.6+ installed.

## Usage

### Validating Schema

To validate your database schema against the expected structure:

```bash
python db_schema_validator.py validate
```

Optional arguments:
- `--db-path PATH`: Specify the path to your SQLite database file
- `--include-extra`: Report extra tables and columns (not just missing ones)
- `--fix`: Attempt to fix detected issues (use with caution)

### Synchronizing Schema

To synchronize your database schema with TypeORM entities:

```bash
python db_schema_validator.py sync
```

This command runs the TypeORM schema synchronization script in your backend application.

## Examples

### Basic Validation

```bash
python db_schema_validator.py validate
```

This will check your database against the expected schema and report any issues.

### Validate with Custom Database Path

```bash
python db_schema_validator.py validate --db-path ./angular/backend/my-database.sqlite
```

### Fix Schema Issues

```bash
python db_schema_validator.py validate --fix
```

This will attempt to automatically fix any schema issues found.

### Synchronize Schema

```bash
python db_schema_validator.py sync
```

## Output

The script generates:
- Console output with validation results
- Log file with detailed validation information
- JSON report file with detailed issue information (when issues are found)

## Debugging

For detailed debugging information, check the log file generated during execution.

## Notes

- The `--fix` option should be used with caution, especially in production environments
- Always back up your database before running with `--fix` enabled
- The script automatically detects your database location by checking common paths 

## Configuration

### Schema Definition

The validator uses a JSON file to define the expected database schema. By default, it looks for `expected_schema.json` in the current directory. You can create your own schema definition file using the following format:

```json
{
  "table_name": {
    "columns": {
      "column_name": {
        "type": "COLUMN_TYPE",
        "nullable": false,
        "primary": true,
        "unique": true,
        "default": "DEFAULT_VALUE"
      },
      // More columns...
    },
    "indexes": {
      "index_name": ["column1", "column2"]
    }
  },
  // More tables...
}
```

For each table, define its columns and indexes. Each column should specify its type and constraints.

### Types in SQLite

SQLite supports the following data types:
- `INTEGER`
- `TEXT`
- `REAL`
- `BLOB`
- `NUMERIC`

Additionally, SQLite allows VARCHAR type definitions like `VARCHAR(50)` for compatibility with other databases, but treats them as `TEXT`.

### Customizing the Validation

You can create your own schema definition file to match your actual database structure. This is useful if you have made intentional schema changes and want to validate against your modified schema.

```bash
python run_validator.py validate --schema-file my_custom_schema.json
```

## Schema Extraction (Coming Soon)

The validator will soon support extracting a schema definition directly from TypeORM entity files:

```bash
python run_validator.py extract --entity-dir ./path/to/entities --output-file extracted_schema.json
```

This will analyze your TypeORM entity files and generate a schema definition that matches your entity structure.

## Troubleshooting

### Common Issues

1. **Database not found**: Make sure the database file exists at the expected location. Use the `--db-path` option to specify a custom path.

2. **Schema file not found**: Ensure your schema definition file exists and is valid JSON. Use the `--schema-file` option to specify a custom path.

3. **Type mismatches**: SQLite's type system is flexible, causing some type mismatches to be reported even when the database will work correctly. For example, `BOOLEAN` is stored as `INTEGER` in SQLite.

### Fixing Schema Issues

For minor issues, you can use the `--fix` option to automatically fix some schema problems:

```bash
python run_validator.py validate --fix
```

For more complex issues, you may need to manually modify your database schema or update your expected schema definition to match the actual structure. 