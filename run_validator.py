#!/usr/bin/env python3
"""
Database Schema Validator Runner

This script serves as a comprehensive helper for running the database schema validator
with proper dependency checking and command-line argument handling. It provides
a more user-friendly interface with multiple sub-commands for different validation
operations.

Key functionality:
1. Dependency verification to ensure all required libraries are available
2. Command-line argument parsing with subcommands
3. Execution of the actual validator script with appropriate parameters

Available Commands:
- validate: Check database against expected schema
- sync: Synchronize database schema with entity definitions
- extract: Extract schema definition from TypeORM entity files

Usage:
    python run_validator.py <command> [options] [--debug]

For detailed help on each command:
    python run_validator.py <command> --help
"""

import os
import sys
import subprocess
import argparse
import logging
from pathlib import Path

# Add parent directory to path to import logging_utils
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.logging_utils import setup_logging

def ensure_dependencies(logger):
    """
    Ensure all required Python dependencies are installed.
    
    Checks for necessary libraries such as sqlite3 and reports
    their availability status.
    
    Args:
        logger (logging.Logger): Logger for reporting dependency status
    
    Returns:
        bool: True if all dependencies are available, False otherwise
    """
    try:
        import sqlite3
        logger.info("SQLite3 is available (built into Python)")
        
        # Check for any additional packages if needed in the future
        return True
    except ImportError as e:
        logger.error(f"Missing dependency: {e}")
        return False

def run_validator(args, logger):
    """
    Run the database schema validator with the given arguments.
    
    Constructs and executes the appropriate command line for the
    validator script based on the provided arguments.
    
    Args:
        args (argparse.Namespace): Command-line arguments parsed by argparse
        logger (logging.Logger): Logger for tracking validator execution
        
    Returns:
        bool: True if validator ran successfully, False otherwise
    """
    validator_script = Path(__file__).parent / "db_schema_validator.py"
    
    logger.debug(f"Validator script path: {validator_script}")
    
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
    
    # Add debug flag if it was provided
    if args.debug:
        cmd.append('--debug')
    
    # Run the validator
    logger.info(f"Running validator with command: {' '.join(cmd)}")
    try:
        process = subprocess.run(cmd, check=True)
        success = process.returncode == 0
        if success:
            logger.info("Validator executed successfully")
        else:
            logger.error(f"Validator failed with exit code {process.returncode}")
        return success
    except subprocess.CalledProcessError as e:
        logger.error(f"Validator failed with exit code {e.returncode}")
        return False
    except Exception as e:
        logger.error(f"Error executing validator: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return False

def main():
    """
    Main entry point for the validator runner.
    
    Sets up argument parsing with subcommands, checks dependencies,
    and executes the validator with the appropriate options.
    
    Returns:
        int: Exit code (0 for success, non-zero for failures)
    """
    parser = argparse.ArgumentParser(description='Run the database schema validator')
    
    # Create subparsers
    subparsers = parser.add_subparsers(dest='command', help='Commands')
    
    # Validate command
    validate_parser = subparsers.add_parser('validate', help='Validate database schema')
    validate_parser.add_argument('--db-path', help='Path to the database file')
    validate_parser.add_argument('--schema-file', default='expected_schema.json', help='Path to the expected schema file')
    validate_parser.add_argument('--include-extra', action='store_true', help='Report extra tables and columns')
    validate_parser.add_argument('--fix', action='store_true', help='Fix schema issues')
    validate_parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    
    # Sync command
    sync_parser = subparsers.add_parser('sync', help='Synchronize database schema')
    sync_parser.add_argument('--db-path', help='Path to the database file')
    sync_parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    
    # Extract command
    extract_parser = subparsers.add_parser('extract', help='Extract schema from TypeORM entity files')
    extract_parser.add_argument('--entity-dir', default='./angular/backend/src/modules', help='Directory containing entity files')
    extract_parser.add_argument('--output-file', default='extracted_schema.json', help='Output file for extracted schema')
    extract_parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    
    args = parser.parse_args()
    
    # Set up logging using the new logging_utils module
    logger = setup_logging('run_validator', args.debug if hasattr(args, 'debug') else False)
    
    logger.info("Database Schema Validator Runner starting")
    
    if not args.command:
        logger.error("No command specified")
        parser.print_help()
        return 1
    
    # Ensure all dependencies are installed
    if not ensure_dependencies(logger):
        logger.error("Missing dependencies. Please install required packages.")
        return 1
    
    # Run the validator
    if run_validator(args, logger):
        logger.info("Validator completed successfully")
        return 0
    else:
        logger.error("Validator failed")
        return 1

if __name__ == "__main__":
    sys.exit(main()) 