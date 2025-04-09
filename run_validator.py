#!/usr/bin/env python3
"""
Helper script to run the database schema validator with proper dependencies
"""

import os
import sys
import subprocess
import argparse
import logging
from pathlib import Path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger('run_validator')

def ensure_dependencies():
    """Ensure all required Python dependencies are installed"""
    try:
        import sqlite3
        logger.info("SQLite3 is available (built into Python)")
        
        # Check for any additional packages if needed in the future
        return True
    except ImportError as e:
        logger.error(f"Missing dependency: {e}")
        return False

def run_validator(args):
    """Run the database schema validator with the given arguments"""
    validator_script = Path(__file__).parent / "db_schema_validator.py"
    
    if not validator_script.exists():
        logger.error(f"Validator script not found at {validator_script}")
        return False
    
    # Make the validator script executable
    os.chmod(validator_script, 0o755)
    
    # Build the command line
    cmd = [sys.executable, str(validator_script)]
    
    # Add the subcommand
    cmd.append(args.command)
    
    # Add any additional arguments
    if args.command == 'validate':
        if args.db_path:
            cmd.extend(['--db-path', args.db_path])
        if args.include_extra:
            cmd.append('--include-extra')
        if args.fix:
            cmd.append('--fix')
        if args.schema_file and args.schema_file != 'expected_schema.json':
            cmd.extend(['--schema-file', args.schema_file])
    elif args.command == 'sync':
        if args.db_path:
            cmd.extend(['--db-path', args.db_path])
    elif args.command == 'extract':
        if args.entity_dir:
            cmd.extend(['--entity-dir', args.entity_dir])
        if args.output_file:
            cmd.extend(['--output-file', args.output_file])
    
    # Run the validator
    logger.info(f"Running validator with command: {' '.join(cmd)}")
    try:
        process = subprocess.run(cmd, check=True)
        return process.returncode == 0
    except subprocess.CalledProcessError as e:
        logger.error(f"Validator failed with exit code {e.returncode}")
        return False

def main():
    parser = argparse.ArgumentParser(description='Run the database schema validator')
    
    subparsers = parser.add_subparsers(dest='command', help='Commands')
    
    # Validate command
    validate_parser = subparsers.add_parser('validate', help='Validate database schema')
    validate_parser.add_argument('--db-path', help='Path to the database file')
    validate_parser.add_argument('--schema-file', default='expected_schema.json', help='Path to the expected schema file')
    validate_parser.add_argument('--include-extra', action='store_true', help='Report extra tables and columns')
    validate_parser.add_argument('--fix', action='store_true', help='Fix schema issues')
    
    # Sync command
    sync_parser = subparsers.add_parser('sync', help='Synchronize database schema')
    sync_parser.add_argument('--db-path', help='Path to the database file')
    
    # Extract command
    extract_parser = subparsers.add_parser('extract', help='Extract schema from TypeORM entity files')
    extract_parser.add_argument('--entity-dir', default='./angular/backend/src/modules', help='Directory containing entity files')
    extract_parser.add_argument('--output-file', default='extracted_schema.json', help='Output file for extracted schema')
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return 1
    
    # Ensure all dependencies are installed
    if not ensure_dependencies():
        logger.error("Missing dependencies. Please install required packages.")
        return 1
    
    # Run the validator
    if run_validator(args):
        logger.info("Validator completed successfully")
        return 0
    else:
        logger.error("Validator failed")
        return 1

if __name__ == "__main__":
    sys.exit(main()) 