# Database Schema Validator

This tool validates and synchronizes your SQLite database schema with TypeORM entity definitions.

## Features

- Extracts schema information from TypeORM entity files
- Compares entity definitions with actual database schema
- Identifies missing tables, columns, and type mismatches
- Generates SQL statements to fix schema differences
- Can synchronize the database automatically (with caution)
- Supports debugging mode for detailed logs

## Installation

No installation is required if you have Python 3.6+ installed. The script uses standard library modules.

## Usage

```bash
# Basic validation (exit status will be 1 if differences are found)
python db_schema_validator.py --validate

# Extract schema information from entities to a JSON file
python db_schema_validator.py --extract --output my_schema.json

# Check differences but don't make changes
python db_schema_validator.py --sync --dry-run

# Apply schema changes to database
python db_schema_validator.py --sync

# Enable debug logging for more detailed information
python db_schema_validator.py --validate --debug

# Use a custom config file
python db_schema_validator.py --validate --config my_config.json
```

## Configuration

The script can be configured using a JSON file. By default, it looks for `db_validator_config.json` in the same directory.

Example configuration:

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

## Limitations

- SQLite has limited support for schema changes. Some differences cannot be fixed automatically.
- Column type changes require a more complex migration script.
- Primary key changes usually require a table rebuild.

## Contributing

Feel free to submit pull requests to improve this tool.

## License

MIT License

## Note about TypeORM types

The script handles mapping from TypeORM types to SQLite types. If you use custom types, you may need to update the `TYPE_MAPPING` dictionary in the script.

## Integration with CI/CD

You can integrate this validator in your CI/CD pipeline to ensure that your entity definitions match your database schema:

```yaml
validate-schema:
  script:
    - python angular/scripts/db_schema_validator.py --validate
``` 