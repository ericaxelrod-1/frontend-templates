# Guide to Modifying the Schema Definition File

This document provides guidance on how to modify the schema definition file (`expected_schema.json`) to match your actual database structure or to define a new expected structure.

## Understanding the Schema Format

The schema definition file uses the following format:

```json
{
  "table_name": {
    "columns": {
      "column_name": {
        "type": "COLUMN_TYPE",
        "nullable": boolean,
        "primary": boolean,
        "unique": boolean,
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

## Adding a New Table

To add a new table to the schema:

1. Open `expected_schema.json` in your text editor
2. Add a new top-level key with the table name
3. Define the columns and indexes for this table

Example:

```json
"my_new_table": {
  "columns": {
    "id": {"type": "INTEGER", "primary": true, "nullable": false},
    "name": {"type": "TEXT", "nullable": false, "unique": true},
    "description": {"type": "TEXT", "nullable": true}
  },
  "indexes": {
    "IDX_my_new_table_name": ["name"]
  }
}
```

## Modifying an Existing Table

To modify an existing table:

1. Find the table in the schema file
2. Add, remove, or modify column definitions as needed
3. Update indexes if necessary

## Fixing Type Mismatches

SQLite treats certain types differently than specified in the schema. Common scenarios:

### BOOLEAN vs INTEGER

SQLite doesn't have a native BOOLEAN type and uses INTEGER instead. If you see type mismatch errors like:

```
Type mismatches: isActive: expected BOOLEAN, got INTEGER
```

Change the type in your schema to match SQLite's representation:

```json
"isActive": {"type": "INTEGER", "nullable": false, "default": 0}
```

### VARCHAR vs TEXT

SQLite treats VARCHAR as TEXT. If you see type mismatch errors like:

```
Type mismatches: name: expected VARCHAR(50), got TEXT
```

You can either:
1. Change the type in your schema to `TEXT`
2. Keep the `VARCHAR(50)` format for documentation purposes, but be aware that SQLite will store it as TEXT

## Handling Foreign Keys

Foreign key relations are defined using the `foreign_key` property:

```json
"user_id": {
  "type": "INTEGER",
  "nullable": false,
  "foreign_key": {
    "table": "users",
    "column": "id"
  }
}
```

## Matching Your Actual Database

If you want to create a schema file that matches your existing database:

1. Run the validator in verbose mode:
   ```
   python validate_db.py --verbose
   ```

2. Review the validation report file (e.g., `db_schema_validation_report_YYYYMMDD_HHMMSS.json`)

3. Update your schema file based on the actual structure reported

## Generating Schema from Entities (Coming Soon)

In a future version, you'll be able to:

```
python run_validator.py extract
```

This will analyze your TypeORM entity files and generate a matching schema definition file automatically. 