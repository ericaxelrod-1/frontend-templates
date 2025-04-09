#!/usr/bin/env python3
"""
Database Initialization Script
Creates an empty SQLite database file if it doesn't exist
"""

import os
import sys
import sqlite3
import argparse
import logging
import json
from pathlib import Path
from datetime import datetime

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(f"db_init_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('db_init')

# Configuration paths
CONFIG_FILE = Path("angular/scripts/db_validator_config.json")
DEFAULT_DB_PATH = Path("angular/backend/data/dev.sqlite")

def load_config(config_path: Path) -> dict:
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

def initialize_database(db_path: Path, force: bool = False) -> bool:
    """Initialize an empty SQLite database"""
    try:
        # Create parent directories if they don't exist
        db_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Check if database already exists
        if db_path.exists() and not force:
            logger.info(f"Database already exists at {db_path}")
            return True
            
        # Create an empty database file
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Create a simple metadata table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS typeorm_metadata (
            type TEXT,
            name TEXT,
            value TEXT
        )
        """)
        
        # Add some basic metadata
        cursor.execute("""
        INSERT INTO typeorm_metadata (type, name, value)
        VALUES (?, ?, ?)
        """, ('initialized', 'date', datetime.now().isoformat()))
        
        conn.commit()
        conn.close()
        
        logger.info(f"Database initialized at {db_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        return False

def check_database(db_path: Path) -> bool:
    """Check if the database at the specified path is valid"""
    if not db_path.exists():
        logger.warning(f"Database does not exist at {db_path}")
        return False
        
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("PRAGMA integrity_check")
        result = cursor.fetchone()
        conn.close()
        
        if result[0] != "ok":
            logger.error(f"Database integrity check failed: {result[0]}")
            return False
            
        logger.info(f"Database at {db_path} is valid")
        return True
    except Exception as e:
        logger.error(f"Database check failed: {e}")
        return False

def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Database Initialization Tool")
    parser.add_argument("--config", type=str, help="Path to config file")
    parser.add_argument("--db-path", type=str, help="Path to database file")
    parser.add_argument("--force", action="store_true", help="Force reinitialization if database exists")
    parser.add_argument("--check-only", action="store_true", help="Only check database, don't initialize")
    
    args = parser.parse_args()
    
    # Load configuration
    config_path = Path(args.config) if args.config else CONFIG_FILE
    config = load_config(config_path)
    
    # Determine paths
    db_path = Path(args.db_path) if args.db_path else Path(config.get("db_path", DEFAULT_DB_PATH))
    
    logger.info(f"Using database path: {db_path}")
    
    # Check if we only need to check the database
    if args.check_only:
        if check_database(db_path):
            logger.info("Database check completed successfully")
            return 0
        else:
            logger.error("Database check failed")
            return 1
    
    # Initialize the database
    if initialize_database(db_path, args.force):
        logger.info("Database initialization completed successfully")
        return 0
    else:
        logger.error("Database initialization failed")
        return 1

if __name__ == "__main__":
    sys.exit(main()) 