#!/usr/bin/env python3
"""
Database Backup Utility
Creates a backup of the SQLite database before schema changes
"""

import os
import sys
import shutil
import argparse
import logging
import json
import sqlite3
from pathlib import Path
from datetime import datetime

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(f"db_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('db_backup')

# Configuration paths
CONFIG_FILE = Path("angular/scripts/db_validator_config.json")
DEFAULT_DB_PATH = Path("angular/backend/data/dev.sqlite")
DEFAULT_BACKUP_DIR = Path("angular/backend/data/backups")

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

def verify_database(db_path: Path) -> bool:
    """Verify that the database is valid"""
    if not db_path.exists():
        logger.error(f"Database file not found at {db_path}")
        return False
        
    try:
        # Try to open and query the database
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("PRAGMA integrity_check")
        result = cursor.fetchone()
        conn.close()
        
        if result[0] != "ok":
            logger.error(f"Database integrity check failed: {result[0]}")
            return False
            
        logger.info("Database integrity verified")
        return True
    except Exception as e:
        logger.error(f"Database verification failed: {e}")
        return False

def create_backup(db_path: Path, backup_dir: Path, test_mode: bool = False) -> Path:
    """Create a backup of the database"""
    # Create backup directory if it doesn't exist
    backup_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate backup filename with timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_path = backup_dir / f"db_backup_{timestamp}.sqlite"
    
    try:
        if test_mode:
            logger.info(f"Test mode: Would copy {db_path} to {backup_path}")
            return backup_path
            
        # Copy the database file
        shutil.copy2(db_path, backup_path)
        logger.info(f"Created backup at {backup_path}")
        
        # Verify the backup
        if not verify_database(backup_path):
            logger.error("Backup verification failed")
            return None
            
        return backup_path
    except Exception as e:
        logger.error(f"Backup creation failed: {e}")
        return None

def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Database Backup Utility")
    parser.add_argument("--config", type=str, help="Path to config file")
    parser.add_argument("--db-path", type=str, help="Path to database file")
    parser.add_argument("--backup-dir", type=str, help="Directory to store backups")
    parser.add_argument("--test", action="store_true", help="Test mode - don't actually create backup")
    
    args = parser.parse_args()
    
    # Load configuration
    config_path = Path(args.config) if args.config else CONFIG_FILE
    config = load_config(config_path)
    
    # Determine paths
    db_path = Path(args.db_path) if args.db_path else Path(config.get("db_path", DEFAULT_DB_PATH))
    backup_dir = Path(args.backup_dir) if args.backup_dir else Path(config.get("backup_dir", DEFAULT_BACKUP_DIR))
    
    logger.info(f"Using database: {db_path}")
    logger.info(f"Using backup directory: {backup_dir}")
    
    # Verify database before backup
    if not verify_database(db_path):
        logger.error("Database verification failed. Backup aborted.")
        return 1
    
    # Create backup
    backup_path = create_backup(db_path, backup_dir, args.test)
    if not backup_path:
        logger.error("Backup failed")
        return 1
        
    # Print summary
    if args.test:
        print(f"Test mode: Would have created backup at {backup_path}")
    else:
        print(f"Backup created successfully at {backup_path}")
    
    return 0

if __name__ == "__main__":
    sys.exit(main()) 