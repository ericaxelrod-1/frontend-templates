#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Schema Alignment Audit Tool

This script performs a comprehensive audit of the SQLite database schema,
comparing the actual database tables, columns, and constraints against
the TypeORM entity decorators and migration scripts.

Usage:
    python schema_alignment_audit.py [--config CONFIG_FILE] [--output OUTPUT_DIR]

Options:
    --config CONFIG_FILE    Path to configuration file (default: config.json)
    --output OUTPUT_DIR     Directory for output reports (default: ./audit_reports)
    --debug                 Enable debug mode for detailed logging
    --fix                   Generate SQL to fix mismatches (careful!)
    --help                  Show this help message

Author: Claude Operator
Date: 2025-05-07
"""

import os
import sys
import json
import sqlite3
import re
import glob
import logging
import argparse
import datetime
from collections import defaultdict
from typing import Dict, List, Set, Tuple, Any, Optional, Union

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ]
)
logger = logging.getLogger("schema_alignment_audit")

class SchemaAlignmentAuditor:
    """
    Main class for auditing schema alignment between database,
    TypeORM entities, and migration scripts.
    """
    
    def __init__(self, config_path: str, output_dir: str, debug: bool = False, fix: bool = False):
        """
        Initialize the auditor with configuration settings.
        
        Args:
            config_path: Path to the configuration file
            output_dir: Directory for output reports
            debug: Enable debug mode for detailed logging
            fix: Generate SQL to fix mismatches
        """
        self.config_path = config_path
        self.output_dir = output_dir
        self.debug = debug
        self.fix = fix
        self.config = {}
        self.conn = None
        self.cursor = None
        self.timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Results storage
        self.db_schema = {}
        self.entity_schema = {}
        self.migration_schema = {}
        self.mismatches = []
        self.db_connection_details = {}  # Store connection details
        
        # Track file processing status
        self.processed_files = []
        self.skipped_files = []
        self.barrel_files = []
        
        # Prepare logger
        if debug:
            logger.setLevel(logging.DEBUG)
        
        # Setup log file handler
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
        
        log_file = os.path.join(output_dir, f"schema_audit_{self.timestamp}.log")
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        logger.addHandler(file_handler)
        
        logger.info(f"Schema Alignment Audit started at {datetime.datetime.now()}")
        logger.info(f"Log file: {log_file}")
    
    def load_config(self) -> None:
        """Load configuration from the specified JSON file."""
        try:
            with open(self.config_path, 'r') as f:
                self.config = json.load(f)
            logger.info(f"Loaded configuration from {self.config_path}")
            
            if self.debug:
                logger.debug(f"Configuration: {json.dumps(self.config, indent=2)}")
        except Exception as e:
            logger.error(f"Error loading configuration: {str(e)}")
            sys.exit(1)
    
    def connect_database(self) -> None:
        """Connect to the SQLite database specified in the configuration."""
        try:
            db_path = os.path.abspath(self.config['database']['path'])
            logger.info(f"Connecting to database: {db_path}")
            
            if not os.path.exists(db_path):
                logger.error(f"Database file not found: {db_path}")
                sys.exit(1)
            
            # Log connection details (noting SQLite specifics)
            connection_details = {
                'db_type': 'SQLite',
                'connection_string': f'sqlite:///{db_path}',  # Standard SQLite connection string format
                'path': db_path,
                'db_name': os.path.basename(db_path),
                'schema_name': None  # Not applicable for SQLite
            }
            
            logger.info(f"Database connection details: {json.dumps(connection_details, indent=2)}")
            
            self.conn = sqlite3.connect(db_path)
            self.conn.row_factory = sqlite3.Row
            self.cursor = self.conn.cursor()
            
            # Enable foreign keys
            self.cursor.execute("PRAGMA foreign_keys = ON;")
            
            # Store connection details for reporting
            self.db_connection_details = connection_details
            
            logger.info("Successfully connected to database")
        except Exception as e:
            logger.error(f"Error connecting to database: {str(e)}")
            sys.exit(1)
    
    def extract_db_schema(self) -> None:
        """Extract the current schema from the SQLite database."""
        logger.info("Extracting database schema...")
        
        try:
            # Get all tables
            self.cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
            tables = [row['name'] for row in self.cursor.fetchall()]
            
            if not tables:
                logger.warning("No tables found in the database")
                return
            
            logger.info(f"Found {len(tables)} tables in database")
            
            # Extract detailed schema for each table
            for table_name in tables:
                logger.debug(f"Extracting schema for table: {table_name}")
                
                # Skip SQLite internal tables
                if table_name.startswith('sqlite_'):
                    logger.debug(f"Skipping SQLite internal table: {table_name}")
                    continue
                
                # Get table creation SQL
                self.cursor.execute(f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{table_name}';")
                create_sql = self.cursor.fetchone()['sql']
                
                # Get column info
                self.cursor.execute(f"PRAGMA table_info({table_name});")
                columns = {}
                for col in self.cursor.fetchall():
                    columns[col['name']] = {
                        'type': col['type'],
                        'nullable': col['notnull'] == 0,
                        'primary': col['pk'] > 0,
                        'default': col['dflt_value']
                    }
                
                # Get foreign key constraints
                self.cursor.execute(f"PRAGMA foreign_key_list({table_name});")
                foreign_keys = []
                for fk in self.cursor.fetchall():
                    foreign_keys.append({
                        'from': fk['from'],
                        'to': fk['to'],
                        'table': fk['table'],
                        'on_update': fk['on_update'],
                        'on_delete': fk['on_delete']
                    })
                
                # Get indexes
                self.cursor.execute(f"PRAGMA index_list({table_name});")
                indexes = []
                for idx in self.cursor.fetchall():
                    index_name = idx['name']
                    self.cursor.execute(f"PRAGMA index_info({index_name});")
                    index_columns = [col['name'] for col in self.cursor.fetchall()]
                    indexes.append({
                        'name': index_name,
                        'columns': index_columns,
                        'unique': idx['unique'] == 1
                    })
                
                # Store the schema information
                self.db_schema[table_name] = {
                    'columns': columns,
                    'foreign_keys': foreign_keys,
                    'indexes': indexes,
                    'create_sql': create_sql
                }
            
            logger.info(f"Successfully extracted schema for {len(self.db_schema)} tables")
            
            if self.debug:
                logger.debug(f"Database schema: {json.dumps(self.db_schema, indent=2, default=str)}")
        
        except Exception as e:
            logger.error(f"Error extracting database schema: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
    
    def extract_entity_schema(self) -> None:
        """Extract schema information from TypeORM entity files."""
        logger.info("Extracting schema from TypeORM entity files...")
        
        # Search for entity files in the expected directories
        entity_files = []
        
        # Main entity directories to search
        entity_dirs = [
            "angular/backend/src/modules/**/entities/*.entity.ts",
            "src/modules/**/entities/*.entity.ts"
        ]
        
        # Find all entity files
        for pattern in entity_dirs:
            entity_files.extend(glob.glob(pattern, recursive=True))
        
        if not entity_files:
            logger.warning("No entity files found")
            return
        
        logger.info(f"Found {len(entity_files)} entity files")
        
        # Extract schema from each entity file
        for file_path in entity_files:
            try:
                logger.debug(f"Processing entity file: {file_path}")
                
                # Read the file
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Check if this is a barrel file (re-export file) that doesn't define entities
                if re.search(r'export\s+\{.*\}\s+from', content) and not re.search(r'@Entity', content):
                    logger.debug(f"Skipping barrel file: {file_path}")
                    self.barrel_files.append(file_path)
                    continue
                
                # Extract entity name and table name
                # More robust regex that handles different formatting and whitespace
                entity_name_match = re.search(r'export\s+class\s+(\w+)(?:\s+extends\s+\w+)?\s*(?:\{|implements)', content)
                if not entity_name_match:
                    # Try alternative pattern for different class declarations
                    entity_name_match = re.search(r'@Entity\([^\)]*\)\s*export\s+class\s+(\w+)', content)
                    if not entity_name_match:
                        logger.warning(f"Could not extract entity name from {file_path}")
                        self.skipped_files.append(file_path)
                        continue
                
                entity_name = entity_name_match.group(1)
                
                # Check if this is an entity class by looking for @Entity decorator
                if not re.search(r'@Entity', content):
                    logger.debug(f"Skipping file {file_path} - not an entity class (no @Entity decorator)")
                    self.skipped_files.append(file_path)
                    continue
                
                # Extract table name from @Entity decorator - more robust pattern
                table_name_match = re.search(r'@Entity\s*\(\s*(?:{[^}]*name\s*:\s*)?[\'"]([^\'"]+)[\'"]', content)
                if table_name_match:
                    table_name = table_name_match.group(1)
                else:
                    # Default to entity name in snake case if not specified
                    table_name = ''.join(['_' + c.lower() if c.isupper() else c for c in entity_name]).lstrip('_')
                    logger.debug(f"No table name specified in decorator, using default: {table_name}")
                
                logger.debug(f"Entity: {entity_name}, Table: {table_name}")
                self.processed_files.append(file_path)
                
                # Extract columns
                columns = {}
                
                # Primary column
                primary_matches = re.finditer(r'@PrimaryGeneratedColumn\s*\((?:\s*[\'"]([^\'"]+)[\'"])?\s*\)\s*(\w+)\s*:\s*(\w+)', content)
                for match in primary_matches:
                    col_name = match.group(2)
                    col_type = match.group(3)
                    columns[col_name] = {
                        'type': self._map_ts_to_sqlite_type(col_type),
                        'primary': True,
                        'nullable': False,
                        'default': None
                    }
                
                # Regular columns
                column_matches = re.finditer(r'@Column\s*\(\s*({[^}]+})\s*\)\s*(\w+)\s*:\s*(\w+)', content)
                for match in column_matches:
                    col_options = match.group(1)
                    col_name = match.group(2)
                    col_type = match.group(3)
                    
                    # Extract column name from options if specified
                    name_match = re.search(r'name\s*:\s*[\'"]([^\'"]+)[\'"]', col_options)
                    db_col_name = name_match.group(1) if name_match else col_name
                    
                    # Extract nullability
                    nullable = 'nullable' in col_options and 'nullable: true' in col_options
                    
                    # Extract default value
                    default_match = re.search(r'default\s*:\s*([^,}]+)', col_options)
                    default_value = default_match.group(1) if default_match else None
                    
                    columns[db_col_name] = {
                        'type': self._map_ts_to_sqlite_type(col_type),
                        'primary': False,
                        'nullable': nullable,
                        'default': default_value
                    }
                
                # Extract relationships - ManyToOne, OneToMany, OneToOne, ManyToMany
                # These aren't directly mapped to columns but can imply foreign keys
                relationships = []
                relationship_patterns = [
                    r'@ManyToOne\s*\(\s*\(\)\s*=>\s*(\w+)',
                    r'@OneToMany\s*\(\s*\(\)\s*=>\s*(\w+)',
                    r'@OneToOne\s*\(\s*\(\)\s*=>\s*(\w+)',
                    r'@ManyToMany\s*\(\s*\(\)\s*=>\s*(\w+)'
                ]
                
                for pattern in relationship_patterns:
                    for match in re.finditer(pattern, content):
                        target_entity = match.group(1)
                        rel_type = pattern.split('\\')[0][1:]  # Extract relationship type from pattern
                        
                        # Find the relationship property
                        prop_pattern = fr'{rel_type}\s*\(\s*\(\)\s*=>\s*{target_entity}[^)]*\)\s*(\w+)\s*:'
                        prop_match = re.search(prop_pattern, content)
                        if prop_match:
                            rel_property = prop_match.group(1)
                            relationships.append({
                                'type': rel_type,
                                'target_entity': target_entity,
                                'property': rel_property
                            })
                
                # Extract JoinColumn information
                join_columns = []
                join_col_pattern = r'@JoinColumn\s*\(\s*({[^}]+})\s*\)'
                for match in re.finditer(join_col_pattern, content):
                    options = match.group(1)
                    name_match = re.search(r'name\s*:\s*[\'"]([^\'"]+)[\'"]', options)
                    ref_match = re.search(r'referencedColumnName\s*:\s*[\'"]([^\'"]+)[\'"]', options)
                    
                    if name_match:
                        join_column = {
                            'name': name_match.group(1),
                            'referencedColumnName': ref_match.group(1) if ref_match else 'id'
                        }
                        join_columns.append(join_column)
                
                # Store all entity schema information
                self.entity_schema[entity_name] = {
                    'file_path': file_path,
                    'table_name': table_name,
                    'columns': columns,
                    'relationships': relationships,
                    'join_columns': join_columns
                }
                
                logger.debug(f"Extracted schema for entity {entity_name}")
            
            except Exception as e:
                logger.error(f"Error processing entity file {file_path}: {str(e)}")
                self.skipped_files.append(file_path)
                import traceback
                logger.error(traceback.format_exc())
        
        # Report summary of processed and skipped files
        logger.info(f"Successfully extracted schema from {len(self.entity_schema)} entities")
        
        if self.debug:
            logger.debug(f"Processed {len(self.processed_files)} entity files")
            logger.debug(f"Skipped {len(self.skipped_files)} files (not valid entities)")
            logger.debug(f"Detected {len(self.barrel_files)} barrel files (re-exports)")
            
            if self.skipped_files:
                logger.debug("Skipped files:")
                for file in self.skipped_files:
                    logger.debug(f"  - {file}")
                    
            if self.barrel_files:
                logger.debug("Barrel files:")
                for file in self.barrel_files:
                    logger.debug(f"  - {file}")
    
    def _map_ts_to_sqlite_type(self, ts_type: str) -> str:
        """Map TypeScript types to SQLite types."""
        type_map = {
            'number': 'INTEGER',
            'string': 'TEXT',
            'boolean': 'INTEGER',
            'Date': 'TEXT',
            'any': 'TEXT',
            'object': 'TEXT',
            'Buffer': 'BLOB'
        }
        return type_map.get(ts_type, 'TEXT')
    
    def extract_migration_schema(self) -> None:
        """Extract schema information from TypeORM migration files."""
        logger.info("Extracting schema from TypeORM migration files...")
        
        # Search for migration files
        migration_dirs = [
            "angular/backend/src/migrations/*.ts",
            "src/migrations/*.ts"
        ]
        
        migration_files = []
        for pattern in migration_dirs:
            migration_files.extend(glob.glob(pattern))
        
        if not migration_files:
            logger.warning("No migration files found")
            return
        
        logger.info(f"Found {len(migration_files)} migration files")
        
        # Process each migration file
        for file_path in migration_files:
            try:
                logger.debug(f"Processing migration file: {file_path}")
                
                # Read the file
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Extract migration name
                name_match = re.search(r'export\s+class\s+(\w+)', content)
                if not name_match:
                    logger.warning(f"Could not extract migration name from {file_path}")
                    continue
                
                migration_name = name_match.group(1)
                
                # Extract table operations
                # Detect createTable operations
                create_table_matches = re.finditer(r'await\s+queryRunner\.createTable\s*\(\s*new\s+Table\s*\(\s*{[^}]*name\s*:\s*[\'"]([^\'"]+)[\'"][^}]*}\s*\)', content)
                created_tables = [match.group(1) for match in create_table_matches]
                
                # Detect addColumn operations
                add_column_pattern = r'await\s+queryRunner\.addColumn\s*\(\s*[\'"]([^\'"]+)[\'"][^)]+\)'
                add_column_matches = re.finditer(add_column_pattern, content)
                modified_tables = [match.group(1) for match in add_column_matches]
                
                # Detect dropTable operations
                drop_table_pattern = r'await\s+queryRunner\.dropTable\s*\(\s*[\'"]([^\'"]+)[\'"]'
                drop_table_matches = re.finditer(drop_table_pattern, content)
                dropped_tables = [match.group(1) for match in drop_table_matches]
                
                # Detect renameTable operations
                rename_table_pattern = r'await\s+queryRunner\.renameTable\s*\(\s*[\'"]([^\'"]+)[\'"][^,]*,\s*[\'"]([^\'"]+)[\'"]'
                rename_table_matches = re.finditer(rename_table_pattern, content)
                renamed_tables = [(match.group(1), match.group(2)) for match in rename_table_matches]
                
                # Detect table schema in createTable
                table_schemas = {}
                schema_pattern = r'await\s+queryRunner\.createTable\s*\(\s*new\s+Table\s*\(\s*{[^}]*name\s*:\s*[\'"]([^\'"]+)[\'"][^}]*columns\s*:\s*\[(.*?)\]'
                schema_matches = re.finditer(schema_pattern, content, re.DOTALL)
                
                for match in schema_matches:
                    table_name = match.group(1)
                    columns_str = match.group(2)
                    
                    # Extract column definitions
                    columns = {}
                    column_pattern = r'new\s+TableColumn\s*\(\s*{([^}]+)}\s*\)'
                    column_matches = re.finditer(column_pattern, columns_str)
                    
                    for col_match in column_matches:
                        col_def = col_match.group(1)
                        
                        # Extract column properties
                        name_match = re.search(r'name\s*:\s*[\'"]([^\'"]+)[\'"]', col_def)
                        type_match = re.search(r'type\s*:\s*[\'"]([^\'"]+)[\'"]', col_def)
                        primary_match = re.search(r'isPrimary\s*:\s*(true|false)', col_def)
                        nullable_match = re.search(r'isNullable\s*:\s*(true|false)', col_def)
                        default_match = re.search(r'default\s*:\s*([^,}]+)', col_def)
                        
                        if name_match and type_match:
                            column_name = name_match.group(1)
                            column_type = type_match.group(1)
                            is_primary = primary_match and primary_match.group(1) == 'true'
                            is_nullable = nullable_match and nullable_match.group(1) == 'true'
                            default_value = default_match.group(1) if default_match else None
                            
                            columns[column_name] = {
                                'type': column_type,
                                'primary': is_primary,
                                'nullable': is_nullable,
                                'default': default_value
                            }
                    
                    table_schemas[table_name] = columns
                
                # Store migration information
                self.migration_schema[migration_name] = {
                    'file_path': file_path,
                    'created_tables': created_tables,
                    'modified_tables': modified_tables,
                    'dropped_tables': dropped_tables,
                    'renamed_tables': renamed_tables,
                    'table_schemas': table_schemas
                }
                
                logger.debug(f"Extracted schema from migration {migration_name}")
            
            except Exception as e:
                logger.error(f"Error processing migration file {file_path}: {str(e)}")
                import traceback
                logger.error(traceback.format_exc())
        
        logger.info(f"Successfully extracted schema from {len(self.migration_schema)} migrations")
    
    def compare_schemas(self) -> None:
        """Compare the database schema with entity and migration schemas to identify mismatches."""
        logger.info("Comparing schemas to identify mismatches...")
        
        if not self.db_schema:
            logger.error("No database schema extracted. Cannot compare.")
            return
            
        # Map entity tables to their database equivalents
        entity_to_db_map = {}
        for entity_name, entity_data in self.entity_schema.items():
            entity_to_db_map[entity_name] = entity_data['table_name']
        
        # Track mismatches
        self.mismatches = []
        
        # 1. Check for tables in the database that don't match any entity
        db_tables = set(self.db_schema.keys())
        entity_tables = set(entity_data['table_name'] for entity_data in self.entity_schema.values())
        
        missing_entity_tables = db_tables - entity_tables
        if missing_entity_tables:
            for table_name in missing_entity_tables:
                self.mismatches.append({
                    'type': 'missing_entity',
                    'table_name': table_name,
                    'detail': f"Table '{table_name}' exists in the database but has no corresponding entity"
                })
                logger.warning(f"Table '{table_name}' exists in the database but has no corresponding entity")
        
        # 2. Check for entities with no corresponding database table
        missing_db_tables = entity_tables - db_tables
        if missing_db_tables:
            for table_name in missing_db_tables:
                # Find the entity that uses this table name
                for entity_name, entity_data in self.entity_schema.items():
                    if entity_data['table_name'] == table_name:
                        self.mismatches.append({
                            'type': 'missing_table',
                            'entity_name': entity_name,
                            'table_name': table_name,
                            'detail': f"Entity '{entity_name}' expects table '{table_name}' which doesn't exist in the database"
                        })
                        logger.warning(f"Entity '{entity_name}' expects table '{table_name}' which doesn't exist in the database")
        
        # 3. For tables that exist in both, compare column definitions
        for entity_name, entity_data in self.entity_schema.items():
            table_name = entity_data['table_name']
            
            # Skip if table doesn't exist in database
            if table_name not in self.db_schema:
                continue
            
            entity_columns = entity_data['columns']
            db_columns = self.db_schema[table_name]['columns']
            
            # 3.1 Check for columns in entity but missing from database
            for col_name, col_data in entity_columns.items():
                if col_name not in db_columns:
                    self.mismatches.append({
                        'type': 'missing_column',
                        'entity_name': entity_name,
                        'table_name': table_name,
                        'column_name': col_name,
                        'detail': f"Column '{col_name}' is defined in entity '{entity_name}' but missing from table '{table_name}'"
                    })
                    logger.warning(f"Column '{col_name}' is defined in entity '{entity_name}' but missing from table '{table_name}'")
                else:
                    # 3.2 Compare column properties
                    db_col = db_columns[col_name]
                    
                    # Check type mismatch
                    if not self._is_type_compatible(col_data['type'], db_col['type']):
                        self.mismatches.append({
                            'type': 'type_mismatch',
                            'entity_name': entity_name,
                            'table_name': table_name,
                            'column_name': col_name,
                            'entity_type': col_data['type'],
                            'db_type': db_col['type'],
                            'detail': f"Column '{col_name}' in table '{table_name}' has type '{db_col['type']}' in DB but '{col_data['type']}' in entity"
                        })
                        logger.warning(f"Column '{col_name}' in table '{table_name}' has type '{db_col['type']}' in DB but '{col_data['type']}' in entity")
                    
                    # Check nullability mismatch
                    if col_data['nullable'] != db_col['nullable']:
                        self.mismatches.append({
                            'type': 'nullability_mismatch',
                            'entity_name': entity_name,
                            'table_name': table_name,
                            'column_name': col_name,
                            'entity_nullable': col_data['nullable'],
                            'db_nullable': db_col['nullable'],
                            'detail': f"Column '{col_name}' in table '{table_name}' has nullability '{db_col['nullable']}' in DB but '{col_data['nullable']}' in entity"
                        })
                        logger.warning(f"Column '{col_name}' in table '{table_name}' has nullability '{db_col['nullable']}' in DB but '{col_data['nullable']}' in entity")
                    
                    # Check primary key mismatch
                    if col_data['primary'] != db_col['primary']:
                        self.mismatches.append({
                            'type': 'primary_key_mismatch',
                            'entity_name': entity_name,
                            'table_name': table_name,
                            'column_name': col_name,
                            'entity_primary': col_data['primary'],
                            'db_primary': db_col['primary'],
                            'detail': f"Column '{col_name}' in table '{table_name}' has primary key status '{db_col['primary']}' in DB but '{col_data['primary']}' in entity"
                        })
                        logger.warning(f"Column '{col_name}' in table '{table_name}' has primary key status '{db_col['primary']}' in DB but '{col_data['primary']}' in entity")
            
            # 3.3 Check for columns in database but missing from entity
            for col_name in db_columns:
                if col_name not in entity_columns:
                    self.mismatches.append({
                        'type': 'extra_column',
                        'entity_name': entity_name,
                        'table_name': table_name,
                        'column_name': col_name,
                        'detail': f"Column '{col_name}' exists in table '{table_name}' but is not defined in entity '{entity_name}'"
                    })
                    logger.warning(f"Column '{col_name}' exists in table '{table_name}' but is not defined in entity '{entity_name}'")
        
        # 4. Check foreign key constraints
        for entity_name, entity_data in self.entity_schema.items():
            table_name = entity_data['table_name']
            
            # Skip if table doesn't exist in database
            if table_name not in self.db_schema:
                continue
            
            # Extract foreign key relationships from entity
            entity_relations = entity_data['relationships']
            join_columns = entity_data['join_columns']
            
            # Map join columns to relationships
            relation_keys = {}
            for i, relation in enumerate(entity_relations):
                if i < len(join_columns):
                    relation_keys[relation['property']] = join_columns[i]['name']
            
            # Get database foreign keys
            db_foreign_keys = self.db_schema[table_name]['foreign_keys']
            
            # Build a set of DB FK signatures for comparison
            db_fk_signatures = set()
            for fk in db_foreign_keys:
                db_fk_signatures.add(f"{fk['from']}:{fk['table']}.{fk['to']}")
            
            # Build entity FK signatures
            entity_fk_signatures = set()
            for rel in entity_relations:
                if rel['type'] in ['ManyToOne', 'OneToOne'] and rel['property'] in relation_keys:
                    col_name = relation_keys[rel['property']]
                    target_entity = rel['target_entity']
                    
                    # Find target table name
                    target_table = None
                    for e, e_data in self.entity_schema.items():
                        if e == target_entity:
                            target_table = e_data['table_name']
                            break
                    
                    if target_table:
                        entity_fk_signatures.add(f"{col_name}:{target_table}.id")
            
            # Check for missing FK constraints
            for entity_fk in entity_fk_signatures:
                if entity_fk not in db_fk_signatures:
                    parts = entity_fk.split(':')
                    col = parts[0]
                    ref = parts[1]
                    self.mismatches.append({
                        'type': 'missing_foreign_key',
                        'entity_name': entity_name,
                        'table_name': table_name,
                        'column_name': col,
                        'reference': ref,
                        'detail': f"Foreign key from '{table_name}.{col}' to '{ref}' is defined in entity but missing from database"
                    })
                    logger.warning(f"Foreign key from '{table_name}.{col}' to '{ref}' is defined in entity but missing from database")
            
            # Check for extra FK constraints
            for db_fk in db_fk_signatures:
                if db_fk not in entity_fk_signatures:
                    parts = db_fk.split(':')
                    col = parts[0]
                    ref = parts[1]
                    self.mismatches.append({
                        'type': 'extra_foreign_key',
                        'entity_name': entity_name,
                        'table_name': table_name,
                        'column_name': col,
                        'reference': ref,
                        'detail': f"Foreign key from '{table_name}.{col}' to '{ref}' exists in database but not in entity"
                    })
                    logger.warning(f"Foreign key from '{table_name}.{col}' to '{ref}' exists in database but not in entity")
        
        logger.info(f"Found {len(self.mismatches)} mismatches between database and entity schemas")
    
    def _is_type_compatible(self, entity_type: str, db_type: str) -> bool:
        """
        Check if the entity type is compatible with the database type.
        SQLite has flexible typing, so this is a bit loose.
        """
        # Convert to uppercase for case-insensitive comparison
        entity_type = entity_type.upper()
        db_type = db_type.upper()
        
        # Direct match
        if entity_type == db_type:
            return True
        
        # Type compatibility mappings
        compatible_types = {
            'INTEGER': ['INT', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'BIGINT', 'NUMBER'],
            'TEXT': ['VARCHAR', 'CHAR', 'NVARCHAR', 'STRING', 'CLOB', 'STRING'],
            'REAL': ['FLOAT', 'DOUBLE', 'DECIMAL', 'NUMBER'],
            'BLOB': ['BINARY', 'VARBINARY', 'BUFFER'],
            'NUMERIC': ['DECIMAL', 'NUMBER', 'INTEGER', 'REAL']
        }
        
        # Check compatibility based on db_type
        for base_type, compatible_list in compatible_types.items():
            if db_type == base_type:
                return entity_type in compatible_list or entity_type == base_type
            elif db_type in compatible_list:
                return entity_type == base_type or entity_type in compatible_list
        
        # SQLite is very flexible, so for non-standard types, we'll be lenient
        return True
    
    def generate_fix_sql(self) -> str:
        """Generate SQL statements to fix the schema mismatches."""
        if not self.fix:
            return "Fix generation not enabled. Run with --fix flag to generate SQL."
        
        if not self.mismatches:
            return "No mismatches found. No fixes needed."
        
        logger.info("Generating SQL to fix schema mismatches...")
        
        fix_statements = []
        fix_statements.append("-- Schema alignment fixes generated on " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        fix_statements.append("-- WARNING: Review these statements carefully before executing them!")
        fix_statements.append("-- It's recommended to back up your database first.")
        fix_statements.append("")
        
        # Group mismatches by table for better organization
        table_mismatches = defaultdict(list)
        for mismatch in self.mismatches:
            table_name = mismatch.get('table_name', 'unknown')
            table_mismatches[table_name].append(mismatch)
        
        # Process each table's mismatches
        for table_name, mismatches in table_mismatches.items():
            fix_statements.append(f"-- Fixes for table: {table_name}")
            
            # Handle missing tables first
            missing_table_mismatches = [m for m in mismatches if m['type'] == 'missing_table']
            for mismatch in missing_table_mismatches:
                entity_name = mismatch['entity_name']
                if entity_name in self.entity_schema:
                    entity_data = self.entity_schema[entity_name]
                    columns = entity_data['columns']
                    
                    # Create CREATE TABLE statement
                    create_statement = [f"CREATE TABLE IF NOT EXISTS {table_name} ("]
                    column_defs = []
                    
                    for col_name, col_data in columns.items():
                        col_def = f"  {col_name} {col_data['type']}"
                        if col_data['primary']:
                            col_def += " PRIMARY KEY"
                        if not col_data['nullable']:
                            col_def += " NOT NULL"
                        if col_data['default'] is not None:
                            col_def += f" DEFAULT {col_data['default']}"
                        column_defs.append(col_def)
                    
                    create_statement.append(",\n".join(column_defs))
                    create_statement.append(");")
                    
                    fix_statements.append("\n".join(create_statement))
            
            # Handle missing columns
            missing_column_mismatches = [m for m in mismatches if m['type'] == 'missing_column']
            for mismatch in missing_column_mismatches:
                entity_name = mismatch['entity_name']
                col_name = mismatch['column_name']
                
                if entity_name in self.entity_schema:
                    columns = self.entity_schema[entity_name]['columns']
                    if col_name in columns:
                        col_data = columns[col_name]
                        
                        # Create ALTER TABLE statement
                        alter_statement = f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_data['type']}"
                        if not col_data['nullable']:
                            alter_statement += " NOT NULL"
                        if col_data['default'] is not None:
                            alter_statement += f" DEFAULT {col_data['default']}"
                        alter_statement += ";"
                        
                        fix_statements.append(alter_statement)
            
            # Handle type mismatches
            type_mismatches = [m for m in mismatches if m['type'] == 'type_mismatch']
            for mismatch in type_mismatches:
                col_name = mismatch['column_name']
                entity_type = mismatch['entity_type']
                
                # SQLite doesn't support direct column type changes, so we need to:
                # 1. Create a new table with the correct schema
                # 2. Copy data from old table to new table
                # 3. Drop old table
                # 4. Rename new table to old table name
                
                # This is complex and requires a full table schema, skipping for now
                fix_statements.append(f"-- Column type mismatch for {table_name}.{col_name}: DB has {mismatch['db_type']}, Entity has {entity_type}")
                fix_statements.append(f"-- SQLite doesn't support direct column type changes. Manual intervention required.")
                fix_statements.append(f"-- Suggested approach:")
                fix_statements.append(f"-- 1. Create a new table with the correct schema")
                fix_statements.append(f"-- 2. Copy data from {table_name} to the new table")
                fix_statements.append(f"-- 3. Drop {table_name}")
                fix_statements.append(f"-- 4. Rename the new table to {table_name}")
            
            # Add a blank line between tables
            fix_statements.append("")
        
        return "\n".join(fix_statements)
    
    def generate_report(self) -> None:
        """Generate a comprehensive report of the schema audit."""
        logger.info("Generating schema audit report...")
        
        report = {
            'timestamp': datetime.datetime.now().isoformat(),
            'database': {
                'connection_details': self.db_connection_details,
                'tables_count': len(self.db_schema),
                'tables': list(self.db_schema.keys())
            },
            'entities': {
                'count': len(self.entity_schema),
                'entities': [
                    {
                        'name': name,
                        'table_name': data['table_name'],
                        'file_path': data['file_path']
                    }
                    for name, data in self.entity_schema.items()
                ],
                'processed_files': len(self.processed_files),
                'skipped_files': len(self.skipped_files),
                'barrel_files': len(self.barrel_files)
            },
            'migrations': {
                'count': len(self.migration_schema),
                'migrations': [
                    {
                        'name': name,
                        'file_path': data['file_path'],
                        'created_tables': data['created_tables'],
                        'modified_tables': data['modified_tables']
                    }
                    for name, data in self.migration_schema.items()
                ]
            },
            'mismatches': {
                'count': len(self.mismatches),
                'by_type': defaultdict(int),
                'details': self.mismatches
            }
        }
        
        # Count mismatches by type
        for mismatch in self.mismatches:
            report['mismatches']['by_type'][mismatch['type']] += 1
        
        # Convert defaultdict to regular dict for JSON serialization
        report['mismatches']['by_type'] = dict(report['mismatches']['by_type'])
        
        # Write report to file
        report_file = os.path.join(self.output_dir, f"schema_audit_report_{self.timestamp}.json")
        with open(report_file, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, default=str)
        
        logger.info(f"Schema audit report written to {report_file}")
        
        # Generate fix SQL if requested
        if self.fix:
            fix_sql = self.generate_fix_sql()
            sql_file = os.path.join(self.output_dir, f"schema_fix_{self.timestamp}.sql")
            with open(sql_file, 'w', encoding='utf-8') as f:
                f.write(fix_sql)
            logger.info(f"Schema fix SQL written to {sql_file}")
        
        # Generate a text summary for console output
        summary = [
            f"Schema Alignment Audit Summary ({datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')})",
            f"Database Type: {self.db_connection_details['db_type']}",
            f"Database Path: {self.db_connection_details['path']}",
            f"Database Name: {self.db_connection_details['db_name']}",
            f"Schema Name: {self.db_connection_details['schema_name'] or 'N/A for SQLite'}",
            f"Tables found: {len(self.db_schema)}",
            f"Entities found: {len(self.entity_schema)}",
            f"Migrations analyzed: {len(self.migration_schema)}",
            f"Total mismatches: {len(self.mismatches)}",
            f"\nFile Processing:",
            f"  - Entity files processed: {len(self.processed_files)}",
            f"  - Files skipped (invalid entities): {len(self.skipped_files)}",
            f"  - Barrel files detected (re-exports): {len(self.barrel_files)}",
            "\nMismatches by type:"
        ]
        
        for mtype, count in report['mismatches']['by_type'].items():
            summary.append(f"  - {mtype}: {count}")
        
        if self.mismatches:
            summary.append("\nTop mismatches:")
            for i, mismatch in enumerate(self.mismatches[:10]):
                summary.append(f"  {i+1}. {mismatch['detail']}")
            
            if len(self.mismatches) > 10:
                summary.append(f"  ... and {len(self.mismatches) - 10} more (see full report)")
        
        summary_text = "\n".join(summary)
        print("\n" + summary_text)
        
        # Also write summary to a text file
        summary_file = os.path.join(self.output_dir, f"schema_audit_summary_{self.timestamp}.txt")
        with open(summary_file, 'w', encoding='utf-8') as f:
            f.write(summary_text)
        
        logger.info(f"Schema audit summary written to {summary_file}")
    
    def run(self) -> None:
        """Execute the full schema alignment audit process."""
        try:
            # Step 1: Load configuration
            self.load_config()
            
            # Step 2: Connect to database
            self.connect_database()
            
            # Step 3: Extract database schema
            self.extract_db_schema()
            
            # Step 4: Extract entity schema
            self.extract_entity_schema()
            
            # Step 5: Extract migration schema
            self.extract_migration_schema()
            
            # Step 6: Compare schemas and identify mismatches
            self.compare_schemas()
            
            # Step 7: Generate report
            self.generate_report()
            
            # Close database connection
            if self.conn:
                self.conn.close()
                logger.info("Database connection closed")
            
            logger.info("Schema alignment audit completed successfully")
        
        except Exception as e:
            logger.error(f"Error during schema alignment audit: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            if self.conn:
                self.conn.close()
            sys.exit(1)

def main():
    """Main entry point for the script."""
    parser = argparse.ArgumentParser(description="Schema Alignment Audit Tool")
    parser.add_argument("--config", default="config.json", help="Path to configuration file")
    parser.add_argument("--output", default="./audit_reports", help="Directory for output reports")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode for detailed logging")
    parser.add_argument("--fix", action="store_true", help="Generate SQL to fix mismatches")
    
    args = parser.parse_args()
    
    # Create and run the auditor
    auditor = SchemaAlignmentAuditor(args.config, args.output, args.debug, args.fix)
    auditor.run()

if __name__ == "__main__":
    main() 