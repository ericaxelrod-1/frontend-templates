#!/usr/bin/env python3
"""
Database Tools - Unified CLI
A combined tool for database validation, backup, and synchronization
"""

import os
import sys
import argparse
import logging
import subprocess
import json
from pathlib import Path
from datetime import datetime

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(f"db_tools_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('db_tools')

# Script locations
SCRIPT_DIR = Path(__file__).parent.absolute()
VALIDATOR_SCRIPT = SCRIPT_DIR / "db_schema_validator.py"
BACKUP_SCRIPT = SCRIPT_DIR / "db_backup.py"
INIT_SCRIPT = SCRIPT_DIR / "init_database.py"
CONFIG_FILE = SCRIPT_DIR / "db_validator_config.json"

def run_command(cmd, description):
    """Run a command and log the results"""
    logger.info(f"Running {description}: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, check=False, text=True, capture_output=True)
        
        if result.stdout:
            for line in result.stdout.splitlines():
                logger.info(f"[{description} stdout] {line}")
                
        if result.stderr:
            for line in result.stderr.splitlines():
                logger.error(f"[{description} stderr] {line}")
                
        logger.info(f"{description} completed with return code {result.returncode}")
        return result.returncode
    except Exception as e:
        logger.error(f"Error running {description}: {str(e)}")
        return 1

def verify_scripts_exist():
    """Verify that all required scripts exist"""
    missing_scripts = []
    
    if not VALIDATOR_SCRIPT.exists():
        missing_scripts.append(str(VALIDATOR_SCRIPT))
        
    if not BACKUP_SCRIPT.exists():
        missing_scripts.append(str(BACKUP_SCRIPT))
        
    if not INIT_SCRIPT.exists():
        missing_scripts.append(str(INIT_SCRIPT))
        
    if missing_scripts:
        logger.error(f"Missing required scripts: {', '.join(missing_scripts)}")
        return False
        
    return True

def create_backup(config_path=None, db_path=None, backup_dir=None, test_mode=False):
    """Create a database backup"""
    cmd = [sys.executable, str(BACKUP_SCRIPT)]
    
    if config_path:
        cmd.extend(["--config", config_path])
        
    if db_path:
        cmd.extend(["--db-path", db_path])
        
    if backup_dir:
        cmd.extend(["--backup-dir", backup_dir])
        
    if test_mode:
        cmd.append("--test")
        
    return run_command(cmd, "Database backup")

def validate_schema(config_path=None, debug=False):
    """Validate database schema against entity definitions"""
    cmd = [sys.executable, str(VALIDATOR_SCRIPT), "--validate"]
    
    if config_path:
        cmd.extend(["--config", config_path])
        
    if debug:
        cmd.append("--debug")
        
    return run_command(cmd, "Schema validation")

def extract_schema(config_path=None, output_file=None, debug=False):
    """Extract schema from entity definitions"""
    cmd = [sys.executable, str(VALIDATOR_SCRIPT), "--extract"]
    
    if config_path:
        cmd.extend(["--config", config_path])
        
    if output_file:
        cmd.extend(["--output", output_file])
        
    if debug:
        cmd.append("--debug")
        
    return run_command(cmd, "Schema extraction")

def synchronize_schema(config_path=None, dry_run=True, debug=False):
    """Synchronize database schema with entity definitions"""
    cmd = [sys.executable, str(VALIDATOR_SCRIPT), "--sync"]
    
    if config_path:
        cmd.extend(["--config", config_path])
        
    if not dry_run:
        # Remove the dry-run flag to actually execute changes
        pass
    else:
        cmd.append("--dry-run")
        
    if debug:
        cmd.append("--debug")
        
    return run_command(cmd, "Schema synchronization")

def initialize_database(config_path=None, db_path=None, force=False, check_only=False):
    """Initialize a new database or check an existing one"""
    cmd = [sys.executable, str(INIT_SCRIPT)]
    
    if config_path:
        cmd.extend(["--config", config_path])
        
    if db_path:
        cmd.extend(["--db-path", db_path])
        
    if force:
        cmd.append("--force")
        
    if check_only:
        cmd.append("--check-only")
        
    return run_command(cmd, "Database initialization")

def check_python_version():
    """Check that the Python version is compatible"""
    if sys.version_info < (3, 6):
        logger.error("This script requires Python 3.6 or higher")
        return False
    return True

def load_config(config_path):
    """Load configuration file"""
    try:
        if Path(config_path).exists():
            with open(config_path, 'r') as f:
                return json.load(f)
        else:
            logger.warning(f"Config file {config_path} not found")
            return {}
    except Exception as e:
        logger.error(f"Error loading config: {e}")
        return {}

def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="Database Tools - Validate, Backup, and Synchronize Database Schema",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Validate the schema
  python db_tools.py validate
  
  # Create a backup of the database
  python db_tools.py backup
  
  # Extract schema to a file
  python db_tools.py extract --output schema.json
  
  # Check what changes would be made to synchronize the schema
  python db_tools.py sync --dry-run
  
  # Apply schema changes to the database (with backup)
  python db_tools.py sync --with-backup
  
  # Initialize a new database if it doesn't exist
  python db_tools.py init
  
  # Full workflow: backup, validate, and synchronize
  python db_tools.py full-sync
"""
    )
    
    # Create subparsers for different commands
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # Validate command
    validate_parser = subparsers.add_parser("validate", help="Validate database schema")
    validate_parser.add_argument("--config", type=str, help="Path to config file")
    validate_parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    
    # Backup command
    backup_parser = subparsers.add_parser("backup", help="Create database backup")
    backup_parser.add_argument("--config", type=str, help="Path to config file")
    backup_parser.add_argument("--db-path", type=str, help="Path to database file")
    backup_parser.add_argument("--backup-dir", type=str, help="Directory to store backups")
    backup_parser.add_argument("--test", action="store_true", help="Test mode - don't actually create backup")
    
    # Extract command
    extract_parser = subparsers.add_parser("extract", help="Extract schema from entities")
    extract_parser.add_argument("--config", type=str, help="Path to config file")
    extract_parser.add_argument("--output", type=str, help="Output file for extracted schema")
    extract_parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    
    # Sync command
    sync_parser = subparsers.add_parser("sync", help="Synchronize database schema")
    sync_parser.add_argument("--config", type=str, help="Path to config file")
    sync_parser.add_argument("--dry-run", action="store_true", default=True, help="Don't execute SQL statements")
    sync_parser.add_argument("--with-backup", action="store_true", help="Create backup before synchronizing")
    sync_parser.add_argument("--force", action="store_true", help="Force synchronization without dry run")
    sync_parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    
    # Init command
    init_parser = subparsers.add_parser("init", help="Initialize database")
    init_parser.add_argument("--config", type=str, help="Path to config file")
    init_parser.add_argument("--db-path", type=str, help="Path to database file")
    init_parser.add_argument("--force", action="store_true", help="Force reinitialization if database exists")
    init_parser.add_argument("--check-only", action="store_true", help="Only check database, don't initialize")
    
    # Full sync command
    full_sync_parser = subparsers.add_parser("full-sync", help="Full workflow: backup, validate, and synchronize")
    full_sync_parser.add_argument("--config", type=str, help="Path to config file")
    full_sync_parser.add_argument("--dry-run", action="store_true", default=True, help="Don't execute SQL statements")
    full_sync_parser.add_argument("--force", action="store_true", help="Force synchronization without dry run")
    full_sync_parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    full_sync_parser.add_argument("--init", action="store_true", help="Initialize database if it doesn't exist")
    
    args = parser.parse_args()
    
    # Check Python version
    if not check_python_version():
        return 1
    
    # Check that required scripts exist
    if not verify_scripts_exist():
        return 1
    
    # Default config path
    config_path = args.config if hasattr(args, 'config') and args.config else str(CONFIG_FILE)
    
    # Execute based on command
    if args.command == "validate":
        return validate_schema(config_path, args.debug)
        
    elif args.command == "backup":
        return create_backup(
            config_path,
            args.db_path if hasattr(args, 'db_path') else None,
            args.backup_dir if hasattr(args, 'backup_dir') else None,
            args.test if hasattr(args, 'test') else False
        )
        
    elif args.command == "extract":
        return extract_schema(
            config_path,
            args.output if hasattr(args, 'output') else None,
            args.debug if hasattr(args, 'debug') else False
        )
        
    elif args.command == "sync":
        # Check if backup is requested
        if hasattr(args, 'with_backup') and args.with_backup:
            backup_result = create_backup(config_path)
            if backup_result != 0:
                logger.error("Backup failed, aborting synchronization")
                return backup_result
        
        # Determine if we should actually execute changes
        dry_run = True
        if hasattr(args, 'dry_run'):
            dry_run = args.dry_run
        if hasattr(args, 'force') and args.force:
            dry_run = False
            
        return synchronize_schema(
            config_path,
            dry_run,
            args.debug if hasattr(args, 'debug') else False
        )
        
    elif args.command == "init":
        return initialize_database(
            config_path,
            args.db_path if hasattr(args, 'db_path') else None,
            args.force if hasattr(args, 'force') else False,
            args.check_only if hasattr(args, 'check_only') else False
        )
        
    elif args.command == "full-sync":
        logger.info("Starting full sync workflow")
        
        # 0. Initialize database if requested
        if hasattr(args, 'init') and args.init:
            logger.info("Step 0: Initializing database")
            init_result = initialize_database(config_path)
            if init_result != 0:
                logger.error("Database initialization failed, aborting sync workflow")
                return init_result
                
        # 1. Create backup
        logger.info("Step 1: Creating database backup")
        backup_result = create_backup(config_path)
        if backup_result != 0:
            logger.error("Backup failed, aborting sync workflow")
            return backup_result
            
        # 2. Validate schema
        logger.info("Step 2: Validating schema")
        validate_result = validate_schema(config_path, args.debug if hasattr(args, 'debug') else False)
        # Continue even if validation fails, we'll fix it in sync
        
        # 3. Synchronize schema
        logger.info("Step 3: Synchronizing schema")
        
        # Determine if we should actually execute changes
        dry_run = True
        if hasattr(args, 'dry_run'):
            dry_run = args.dry_run
        if hasattr(args, 'force') and args.force:
            dry_run = False
            
        sync_result = synchronize_schema(
            config_path,
            dry_run,
            args.debug if hasattr(args, 'debug') else False
        )
        
        logger.info("Full sync workflow complete")
        return sync_result
        
    else:
        parser.print_help()
        return 0

if __name__ == "__main__":
    sys.exit(main()) 