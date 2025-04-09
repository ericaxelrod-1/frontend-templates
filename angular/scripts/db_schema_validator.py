#!/usr/bin/env python3
# Database Schema Validator
# A tool to validate and synchronize database schema with TypeORM entities

import os
import sys
import json
import glob
import re
import argparse
import logging
import sqlite3
import subprocess
from pathlib import Path
from typing import Dict, List, Any, Optional, Set, Tuple
from datetime import datetime

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(f"schema_validator_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('db_schema_validator')

# Configuration paths
CONFIG_FILE = Path("angular/scripts/db_validator_config.json")
DEFAULT_SCHEMA_FILE = Path("angular/scripts/expected_schema.json")
DEFAULT_ENTITIES_PATH = Path("angular/backend/src/modules")
DEFAULT_DB_PATH = Path("angular/backend/data/dev.sqlite")

# TypeORM to SQLite type mapping
TYPE_MAPPING = {
    "int": "INTEGER",
    "integer": "INTEGER",
    "number": "INTEGER",
    "bigint": "INTEGER",
    "smallint": "INTEGER",
    "tinyint": "INTEGER",
    "boolean": "INTEGER",
    "bool": "INTEGER",
    "varchar": "TEXT",
    "character varying": "TEXT",
    "char": "TEXT",
    "text": "TEXT",
    "string": "TEXT",
    "date": "TEXT",
    "datetime": "TEXT",
    "timestamp": "TEXT",
    "json": "TEXT",
    "float": "REAL",
    "double": "REAL",
    "decimal": "REAL",
    "blob": "BLOB"
}

class SchemaValidator:
    def __init__(self, config_path: Optional[Path] = None):
        """Initialize the schema validator with configuration"""
        self.config = self._load_config(config_path or CONFIG_FILE)
        self.entities_path = Path(self.config.get("entities_path", DEFAULT_ENTITIES_PATH))
        self.db_path = Path(self.config.get("db_path", DEFAULT_DB_PATH))
        self.schema_file = Path(self.config.get("schema_file", DEFAULT_SCHEMA_FILE))
        self.debug = self.config.get("debug", False)
        
        if self.debug:
            logger.setLevel(logging.DEBUG)
            logger.debug("Debug mode enabled")
            
        logger.info(f"Initialized SchemaValidator with entities path: {self.entities_path}")
        logger.info(f"Database path: {self.db_path}")
        logger.info(f"Schema file: {self.schema_file}")
        
    def _load_config(self, config_path: Path) -> Dict[str, Any]:
        """Load configuration from JSON file"""
        try:
            if config_path.exists():
                with open(config_path, 'r') as f:
                    config = json.load(f)
                logger.info(f"Loaded configuration from {config_path}")
                return config
            else:
                logger.warning(f"Config file {config_path} not found, using defaults")
                return {}
        except Exception as e:
            logger.error(f"Failed to load config: {e}")
            return {}
    
    def _get_sqlite_connection(self) -> sqlite3.Connection:
        """Get a connection to the SQLite database"""
        if not self.db_path.exists():
            logger.error(f"Database file not found at {self.db_path}")
            raise FileNotFoundError(f"Database file not found at {self.db_path}")
            
        try:
            return sqlite3.connect(self.db_path)
        except sqlite3.Error as e:
            logger.error(f"Failed to connect to database: {e}")
            raise
    
    def _parse_entity_files(self) -> Dict[str, Dict[str, Any]]:
        """Parse TypeORM entity files to extract schema information"""
        logger.info(f"Parsing entity files from {self.entities_path}")
        entities = {}
        
        # Find all entity files
        entity_files = list(self.entities_path.glob("**/*entity.ts"))
        logger.info(f"Found {len(entity_files)} entity files")
        
        for file_path in entity_files:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Extract entity name
                entity_name_match = re.search(r'export\s+class\s+(\w+)', content)
                if not entity_name_match:
                    logger.warning(f"Could not find entity name in {file_path}")
                    continue
                
                entity_name = entity_name_match.group(1)
                logger.debug(f"Processing entity: {entity_name} from {file_path}")
                
                # Extract table name
                table_name_match = re.search(r'@Entity\(\s*[\'"]?([\w_]+)[\'"]?\s*\)', content)
                table_name = table_name_match.group(1) if table_name_match else entity_name.lower()
                
                # Extract columns
                columns = {}
                column_matches = re.finditer(r'@Column\((.*?)\)\s*(\w+)\s*:\s*(\w+)', content, re.DOTALL)
                
                for match in column_matches:
                    column_options = match.group(1)
                    column_name = match.group(2)
                    column_type = match.group(3)
                    
                    # Parse column options
                    nullable = not re.search(r'nullable\s*:\s*false', column_options)
                    primary = bool(re.search(r'primary\s*:\s*true', column_options))
                    
                    # Extract SQL type if specified
                    type_match = re.search(r'type\s*:\s*[\'"](\w+)[\'"]', column_options)
                    sql_type = type_match.group(1) if type_match else column_type
                    
                    # Map to SQLite type
                    sqlite_type = TYPE_MAPPING.get(sql_type.lower(), "TEXT")
                    
                    columns[column_name] = {
                        "type": sqlite_type,
                        "nullable": nullable,
                        "primary": primary
                    }
                
                # Extract primary keys from @PrimaryColumn decorators
                primary_matches = re.finditer(r'@PrimaryColumn\((.*?)\)\s*(\w+)\s*:', content, re.DOTALL)
                for match in primary_matches:
                    column_name = match.group(2)
                    if column_name in columns:
                        columns[column_name]["primary"] = True
                    
                entities[entity_name] = {
                    "table_name": table_name,
                    "columns": columns,
                    "file_path": str(file_path)
                }
                
            except Exception as e:
                logger.error(f"Error processing entity file {file_path}: {e}")
                
        return entities
    
    def _extract_db_schema(self) -> Dict[str, Dict[str, Any]]:
        """Extract schema from the SQLite database"""
        logger.info(f"Extracting schema from database: {self.db_path}")
        db_schema = {}
        
        try:
            conn = self._get_sqlite_connection()
            cursor = conn.cursor()
            
            # Get all tables
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            tables = cursor.fetchall()
            
            for (table_name,) in tables:
                logger.debug(f"Processing table: {table_name}")
                
                # Get table info
                cursor.execute(f"PRAGMA table_info({table_name})")
                columns_info = cursor.fetchall()
                
                columns = {}
                for col_info in columns_info:
                    cid, name, type_name, not_null, default_value, pk = col_info
                    columns[name] = {
                        "type": type_name.upper(),
                        "nullable": not not_null,
                        "primary": bool(pk),
                        "default": default_value
                    }
                
                db_schema[table_name] = {
                    "columns": columns
                }
                
            conn.close()
            
        except Exception as e:
            logger.error(f"Failed to extract database schema: {e}")
            raise
            
        return db_schema
    
    def _compare_schemas(self, entity_schema: Dict[str, Dict[str, Any]], 
                         db_schema: Dict[str, Dict[str, Any]]) -> Tuple[List[str], List[str]]:
        """Compare entity schema with database schema"""
        logger.info("Comparing schemas")
        differences = []
        sql_statements = []
        
        # Check each entity against the DB schema
        for entity_name, entity_info in entity_schema.items():
            table_name = entity_info["table_name"]
            
            # Check if table exists
            if table_name not in db_schema:
                differences.append(f"Table '{table_name}' does not exist in the database")
                
                # Generate CREATE TABLE statement
                create_stmt = [f"CREATE TABLE {table_name} ("]
                column_defs = []
                
                for col_name, col_info in entity_info["columns"].items():
                    nullable = "" if col_info["nullable"] else "NOT NULL"
                    primary = "PRIMARY KEY" if col_info["primary"] else ""
                    column_defs.append(f"    {col_name} {col_info['type']} {primary} {nullable}".strip())
                
                create_stmt.append(",\n".join(column_defs))
                create_stmt.append(");")
                sql_statements.append("\n".join(create_stmt))
                continue
            
            # Check columns
            db_columns = db_schema[table_name]["columns"]
            entity_columns = entity_info["columns"]
            
            for col_name, col_info in entity_columns.items():
                if col_name not in db_columns:
                    differences.append(f"Column '{col_name}' in table '{table_name}' does not exist in the database")
                    
                    # Generate ALTER TABLE ADD COLUMN statement
                    nullable = "" if col_info["nullable"] else "NOT NULL"
                    sql_statements.append(
                        f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_info['type']} {nullable};".strip()
                    )
                    continue
                
                # Check column type
                db_col_info = db_columns[col_name]
                if col_info["type"] != db_col_info["type"]:
                    differences.append(
                        f"Column '{col_name}' in table '{table_name}' has different type: "
                        f"entity: {col_info['type']}, db: {db_col_info['type']}"
                    )
                    # SQLite doesn't support ALTER COLUMN TYPE directly
                    
                # Check nullability
                if col_info["nullable"] != db_col_info["nullable"]:
                    differences.append(
                        f"Column '{col_name}' in table '{table_name}' has different nullability: "
                        f"entity: {col_info['nullable']}, db: {db_col_info['nullable']}"
                    )
                    # SQLite doesn't support ALTER COLUMN NOT NULL directly
        
            # Check for extra columns in DB
            for col_name in db_columns:
                if col_name not in entity_columns:
                    differences.append(f"Extra column '{col_name}' in table '{table_name}' in the database")
                    
        return differences, sql_statements
    
    def _save_schema(self, schema: Dict[str, Dict[str, Any]], output_file: Path):
        """Save schema to a JSON file"""
        try:
            with open(output_file, 'w') as f:
                json.dump(schema, f, indent=2)
            logger.info(f"Schema saved to {output_file}")
        except Exception as e:
            logger.error(f"Failed to save schema: {e}")
    
    def validate(self) -> bool:
        """Validate the database schema against entity definitions"""
        try:
            # Extract schema from entities
            entity_schema = self._parse_entity_files()
            
            # Extract schema from database
            db_schema = self._extract_db_schema()
            
            # Compare schemas
            differences, sql_statements = self._compare_schemas(entity_schema, db_schema)
            
            if differences:
                logger.warning(f"Found {len(differences)} differences between entity and database schemas")
                for diff in differences:
                    logger.warning(f"  - {diff}")
                
                if sql_statements:
                    logger.info(f"Generated {len(sql_statements)} SQL statements to fix differences")
                    for stmt in sql_statements:
                        logger.info(f"  {stmt}")
                
                return False
            else:
                logger.info("No differences found. Schema is valid.")
                return True
                
        except Exception as e:
            logger.error(f"Validation failed: {e}")
            return False
    
    def extract_schema(self, output_file: Optional[Path] = None) -> Dict[str, Dict[str, Any]]:
        """Extract and save schema from TypeORM entities"""
        try:
            entity_schema = self._parse_entity_files()
            
            if output_file:
                self._save_schema(entity_schema, output_file)
                
            return entity_schema
        except Exception as e:
            logger.error(f"Schema extraction failed: {e}")
            return {}
    
    def synchronize(self, dry_run: bool = True) -> bool:
        """Synchronize database schema with entity definitions"""
        try:
            # Extract schema from entities
            entity_schema = self._parse_entity_files()
            
            # Extract schema from database
            db_schema = self._extract_db_schema()
            
            # Compare schemas
            differences, sql_statements = self._compare_schemas(entity_schema, db_schema)
            
            if not differences:
                logger.info("No differences found. Schema is already synchronized.")
                return True
                
            logger.info(f"Found {len(differences)} differences to synchronize")
            
            if dry_run:
                logger.info("Dry run: would execute the following SQL statements:")
                for stmt in sql_statements:
                    logger.info(stmt)
                return True
            
            # Execute SQL statements
            conn = self._get_sqlite_connection()
            cursor = conn.cursor()
            
            for stmt in sql_statements:
                logger.info(f"Executing: {stmt}")
                cursor.execute(stmt)
                
            conn.commit()
            conn.close()
            
            logger.info("Database schema synchronized successfully")
            return True
            
        except Exception as e:
            logger.error(f"Synchronization failed: {e}")
            return False

def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Database Schema Validator")
    parser.add_argument("--config", type=str, help="Path to config file")
    parser.add_argument("--validate", action="store_true", help="Validate schema")
    parser.add_argument("--extract", action="store_true", help="Extract schema from entities")
    parser.add_argument("--sync", action="store_true", help="Synchronize database schema")
    parser.add_argument("--output", type=str, help="Output file for extracted schema")
    parser.add_argument("--dry-run", action="store_true", help="Don't execute SQL statements")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    
    args = parser.parse_args()
    
    config_path = Path(args.config) if args.config else CONFIG_FILE
    validator = SchemaValidator(config_path)
    
    if args.debug:
        logger.setLevel(logging.DEBUG)
        
    if args.validate:
        result = validator.validate()
        sys.exit(0 if result else 1)
        
    elif args.extract:
        output_file = Path(args.output) if args.output else validator.schema_file
        validator.extract_schema(output_file)
        
    elif args.sync:
        validator.synchronize(dry_run=args.dry_run)
        
    else:
        parser.print_help()

if __name__ == "__main__":
    main() 