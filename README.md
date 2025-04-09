# Database Schema Validator and Synchronizer

A set of Python scripts for validating and synchronizing database schema in a TypeORM-based application.

## Overview

This project provides tools to:

1. **Validate** your database schema against an expected structure
2. **Report** inconsistencies between your database and expected schema
3. **Fix** schema issues automatically where possible
4. **Synchronize** your database with TypeORM entities

## Files in this Project

- `db_schema_validator.py` - The main validator script
- `run_validator.py` - Helper script to run the validator with proper setup
- `validate_db.py` - Simplified interface for common validation tasks
- `expected_schema.json` - Definition of the expected database schema
- `db_validator_config.json` - Configuration for the validator
- `db_schema_validator_README.md` - Detailed documentation
- `schema_modification_guide.md` - Guide for modifying the schema definition

## Quick Start

### Validate your database

```bash
python validate_db.py
```

### Include extra information in the report

```bash
python validate_db.py --verbose
```

### Specify custom database or schema file

```bash
python validate_db.py --db ./path/to/database.sqlite --schema ./path/to/schema.json
```

### Try to fix schema issues

```bash
python validate_db.py --fix
```

## Documentation

For more detailed information, see:

- [Validator Documentation](db_schema_validator_README.md)
- [Schema Modification Guide](schema_modification_guide.md)

## Requirements

- Python 3.6+
- SQLite3 (included in Python standard library)

## License

MIT
