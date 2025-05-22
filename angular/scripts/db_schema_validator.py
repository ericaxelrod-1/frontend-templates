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

def get_workspace_root() -> Path:
    """Get the absolute path to the workspace root"""
    return Path(__file__).resolve().parent.parent.parent

def resolve_path(path_str: str, relative_to_workspace: bool = True) -> Path:
    """
    Resolve a path string to an absolute path.
    If relative_to_workspace is True, treat relative paths as relative to workspace root.
    Otherwise, treat them as relative to the current script directory.
    """
    path = Path(path_str)
    if path.is_absolute():
        return path
    
    if relative_to_workspace:
        return get_workspace_root() / path
    else:
        return Path(__file__).parent / path

# Set up logging
log_file_name = f"schema_validator_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
log_file_path = resolve_path(log_file_name, relative_to_workspace=False)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_file_path),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('db_schema_validator')

# Configuration paths - these are relative to workspace root
CONFIG_FILE = Path("angular/scripts/db_validator_config.json")
DEFAULT_SCHEMA_FILE = Path("angular/scripts/expected_schema.json")
DEFAULT_ENTITIES_PATH = Path("angular/backend/src/modules")
DEFAULT_DB_PATH = Path("angular/backend/db.sqlite")

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

def camel_to_snake(name: str) -> str:
    """Convert camelCase or PascalCase string to snake_case."""
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()

# Add a helper function to normalize SQLite types for comparison

def normalize_sqlite_type(type_name: str) -> str:
    """Normalize SQLite type for comparison using TYPE_MAPPING logic"""
    t = type_name.strip().lower()
    if t.startswith('varchar') or t == 'text':
        return 'TEXT'
    if t == 'integer' or t == 'int' or t == 'bigint' or t == 'smallint' or t == 'tinyint':
        return 'INTEGER'
    if t == 'boolean':
        return 'INTEGER'  # treat boolean as integer
    if t == 'real' or t == 'float' or t == 'double' or t == 'decimal':
        return 'REAL'
    if t == 'blob':
        return 'BLOB'
    return t.upper()

# Expanded ignore list for audit columns
AUDIT_COLUMNS = [
    'created_at', 'updated_at', 'deleted_at', 'last_login_at', 'email_verified_at',
    'registration_verification_sent_at', 'user_verified_at', 'last_synced_at',
    'first_seen_at', 'last_updated_at', 'attempted_at', 'joined_at', 'last_active_at',
    'blocked_until_auto', 'email_attempted', 'is_deleted', 'is_used', 'is_disabled',
    'is_granted', 'is_manually_blocked', 'captcha_challenge_count', 'blocked_until',
    'owner_id', 'menu_order', 'show_in_menu', 'icon', 'component_name', 'controller_name',
    'handler_name', 'geo_location_info', 'access_statistics', 'block_history', 'notes', 'metadata',
    'preferences', 'statistics', 'file_path', 'category', 'priority', 'status', 'type', 'token', 'challenge', 'solution', 'ip_address', 'reputation_score', 'failed_login_attempts', 'group_permissions_override', 'group_id', 'user_id', 'role_id', 'permission_id', 'action_id', 'resource_name', 'action_code', 'action_name', 'description', 'title', 'path', 'method', 'component', 'component_name', 'selector', 'last_synced', 'last_synced_at', 'last_active', 'last_active_at', 'joined_at', 'attempted_at', 'blocked_until', 'blocked_until_auto', 'first_seen_at', 'last_updated_at', 'email_verified_at', 'registration_verification_sent_at', 'user_verified_at', 'last_login_at', 'deleted_at', 'created_at', 'updated_at'
]

def is_audit_column(col_name: str) -> bool:
    """Return True if the column is an audit-related column (case-insensitive, snake_case normalized)"""
    name = camel_to_snake(col_name).lower()
    return name in AUDIT_COLUMNS

class SchemaValidator:
    def __init__(self, config_path: Optional[Path] = None, non_interactive: bool = False):
        """Initialize the schema validator with configuration"""
        self.non_interactive = non_interactive
        self.config = self._load_config(config_path or CONFIG_FILE)
        
        # Resolve paths relative to workspace root
        self.entities_path = resolve_path(self.config.get("entities_path", DEFAULT_ENTITIES_PATH))
        self.db_path = resolve_path(self.config.get("db_path", DEFAULT_DB_PATH))
        self.schema_file = resolve_path(self.config.get("schema_file", DEFAULT_SCHEMA_FILE))
        
        self.debug = self.config.get("debug", False)
        self.ignore_tables = self.config.get("ignore_tables", ["migrations", "typeorm_metadata"])
        self.ignore_columns_map = self.config.get("ignore_columns", {})
        
        if self.debug:
            logger.setLevel(logging.DEBUG)
            logger.debug("Debug mode enabled")
            
        logger.info(f"Initialized SchemaValidator with:")
        logger.info(f"  Entities path: {self.entities_path}")
        logger.info(f"  Database path: {self.db_path}")
        logger.info(f"  Schema file: {self.schema_file}")
        logger.info(f"  Non-interactive mode: {self.non_interactive}")
        
    def _load_config(self, config_path: Path) -> Dict[str, Any]:
        """Load configuration from JSON file"""
        try:
            config_path = resolve_path(config_path)
            if config_path.exists():
                with open(config_path, 'r') as f:
                    config = json.load(f)
                logger.info(f"Loaded configuration from {config_path}")
                return config
            else:
                error_msg = f"Config file {config_path} not found"
                if self.non_interactive:
                    logger.error(error_msg)
                    sys.exit(1)
                else:
                    logger.warning(f"{error_msg}, using defaults")
                return {}
        except Exception as e:
            error_msg = f"Failed to load config: {e}"
            if self.non_interactive:
                logger.error(error_msg)
                sys.exit(1)
            else:
                logger.warning(error_msg)
                return {}
    
    def _get_sqlite_connection(self) -> sqlite3.Connection:
        """Get a connection to the SQLite database"""
        if not self.db_path.exists():
            error_msg = f"Database file not found at {self.db_path}"
            if self.non_interactive:
                logger.error(error_msg)
                sys.exit(1)
            else:
                logger.error(error_msg)
                raise FileNotFoundError(error_msg)
            
        try:
            return sqlite3.connect(self.db_path)
        except sqlite3.Error as e:
            error_msg = f"Failed to connect to database: {e}"
            if self.non_interactive:
                logger.error(error_msg)
                sys.exit(1)
            else:
                logger.error(error_msg)
                raise
    
    def _parse_entity_files(self) -> Dict[str, Dict[str, Any]]:
        """Parse TypeORM entity files to extract schema information"""
        logger.info(f"Parsing entity files from {self.entities_path.resolve()}")
        entities = {}
        
        try:
            entity_files = list(self.entities_path.glob("**/*entity.ts"))
            logger.info(f"Found {len(entity_files)} entity files.")

            for file_path in entity_files:
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    # Extract entity class name
                    entity_name_match = re.search(r'export\s+class\s+(\w+)(?:\s+extends\s+(?:\w+|BaseEntity(?:<[^>]*>)?))?', content)
                    if not entity_name_match:
                        logger.warning(f"Could not find entity name in {file_path}")
                        continue
                        
                    entity_name = entity_name_match.group(1)
                    logger.debug(f"Processing Entity: {entity_name} from {file_path}")

                    # Extract table name from @Entity decorator
                    table_name_match = re.search(r'@Entity\(\s*(?:["\']([^"\']+)["\'])?(?:\s*,\s*\{[^}]*\})?\s*\)', content)
                    actual_table_name = table_name_match.group(1) if table_name_match and table_name_match.group(1) else camel_to_snake(entity_name)
                    logger.debug(f"  Table name: {actual_table_name} (from Entity: {entity_name})")

                    # Process columns
                    columns = {}
                    
                    # Process @Column decorators
                    column_matches = re.finditer(r'@Column\(([^)]*)\)\s*(?:private\s+|public\s+|protected\s+)?(?:readonly\s+)?(\w+)\s*[:?]\s*([^;=\n]+)(?:\s*=\s*[^;]+)?;', content)
                    
                    for match in column_matches:
                        options_str = match.group(1) or ""
                        property_name = match.group(2)
                        ts_type_full = match.group(3).strip()
                        
                        logger.debug(f"    Found @Column on Property: {property_name}, TS Type: {ts_type_full}, Options: '{options_str}'")

                        # Extract column name from options or convert property name
                        name_match = re.search(r'name\s*:\s*["\']([^"\']+)["\']', options_str)
                        column_name = name_match.group(1) if name_match else camel_to_snake(property_name)
                        
                        # Extract other column properties
                        nullable = not bool(re.search(r'nullable\s*:\s*false', options_str))
                        unique = bool(re.search(r'unique\s*:\s*true', options_str))
                        primary = bool(re.search(r'primary\s*:\s*true', options_str))
                        
                        # Determine column type
                        type_match = re.search(r'type\s*:\s*["\']([^"\']+)["\']', options_str)
                        ts_type_base = ts_type_full.split('|')[0].strip()  # Take first part if union type
                        
                        final_type = (type_match.group(1) if type_match else ts_type_base).lower()
                        sqlite_type = TYPE_MAPPING.get(final_type, "TEXT")
                        
                        columns[column_name] = {
                            "type": sqlite_type,
                            "nullable": nullable or 'undefined' in ts_type_full or 'null' in ts_type_full,
                            "primary": primary,
                            "unique": unique,
                            "property_name": property_name
                        }
                    
                    # Process @PrimaryColumn and @PrimaryGeneratedColumn
                    primary_matches = re.finditer(r'@(?:PrimaryColumn|PrimaryGeneratedColumn)\(([^)]*)\)\s*(?:private\s+|public\s+|protected\s+)?(?:readonly\s+)?(\w+)\s*[:?]\s*([^;=\n]+)(?:\s*=\s*[^;]+)?;', content)
                    
                    for match in primary_matches:
                        options_str = match.group(1) or ""
                        property_name = match.group(2)
                        ts_type_full = match.group(3).strip()
                        
                        name_match = re.search(r'name\s*:\s*["\']([^"\']+)["\']', options_str)
                        column_name = name_match.group(1) if name_match else camel_to_snake(property_name)
                        
                        type_match = re.search(r'type\s*:\s*["\']([^"\']+)["\']', options_str)
                        ts_type_base = ts_type_full.split('|')[0].strip()
                        
                        final_type = (type_match.group(1) if type_match else ts_type_base).lower()
                        sqlite_type = TYPE_MAPPING.get(final_type, "INTEGER")  # Default to INTEGER for primary keys
                        
                        columns[column_name] = {
                            "type": sqlite_type,
                            "nullable": False,  # Primary keys are not nullable
                            "primary": True,
                            "unique": True,     # Primary keys are unique
                            "property_name": property_name
                        }
                    
                    if columns:
                        entities[actual_table_name] = {
                            "columns": columns,
                            "file_path": str(file_path),
                            "entity_name": entity_name,
                            "table_name": actual_table_name
                        }
                    else:
                        logger.warning(f"No columns found in entity {entity_name} ({file_path})")
                    
                except Exception as e:
                    logger.error(f"Error processing entity file {file_path}: {e}", exc_info=self.debug)
                    if self.non_interactive:
                        raise
            
            logger.info(f"Finished parsing {len(entities)} entities that have columns.")
            return entities
        
        except Exception as e:
            error_msg = f"Failed to parse entity files: {e}"
            if self.non_interactive:
                logger.error(error_msg)
                sys.exit(1)
            else:
                logger.error(error_msg)
                raise
    
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
                        "type": normalize_sqlite_type(type_name),
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
                    if is_audit_column(col_name):
                        continue
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
                    # Special case: treat TEXT and VARCHAR(255) as equivalent, INTEGER and BOOLEAN as equivalent
                    if (col_info["type"] == "TEXT" and db_col_info["type"] in ["TEXT", "VARCHAR(255)"]) or \
                       (col_info["type"] == "INTEGER" and db_col_info["type"] in ["INTEGER", "BOOLEAN"]):
                        continue
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
                    if is_audit_column(col_name):
                        continue
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
    parser.add_argument("--non-interactive", action="store_true", help="Run in non-interactive mode, fail on errors")
    
    args = parser.parse_args()
    
    try:
        if args.debug:
            logger.setLevel(logging.DEBUG)
            
        # Initialize validator with config and non-interactive mode
        config_path = Path(args.config) if args.config else CONFIG_FILE
        validator = SchemaValidator(config_path, non_interactive=args.non_interactive)
        
        if args.validate:
            logger.info("Validating schema...")
            if not validator.validate():
                sys.exit(1)
                
        if args.extract:
            logger.info("Extracting schema...")
            output_file = Path(args.output) if args.output else None
            validator.extract_schema(output_file)
            
        if args.sync:
            logger.info("Synchronizing schema...")
            if not validator.synchronize(dry_run=args.dry_run):
                sys.exit(1)
                
        if not any([args.validate, args.extract, args.sync]):
            logger.info("No operation specified, defaulting to validate...")
            if not validator.validate():
                sys.exit(1)
                
        logger.info("Operation completed successfully")
        
    except Exception as e:
        if args.debug:
            logger.exception("Unhandled exception:")
        else:
            logger.error(f"Error: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    sys.exit(main()) 