#!/usr/bin/env python3
"""
Database Schema Validation Helper

This script provides a simplified interface to run the database schema validator
with commonly used options. It serves as a user-friendly wrapper around the more
complex validation functionality.

The validator compares the structure of a SQLite database against expected schema
definitions, reporting any discrepancies and optionally fixing issues.

Usage:
    python validate_db.py [options]

Options:
    --verbose, -v: Include extra tables and columns in the report
    --fix, -f: Fix schema issues if possible
    --db: Path to the SQLite database file
    --schema: Path to the schema definition file
    --debug: Enable debug logging
"""

import os
import sys
import argparse
import subprocess
from pathlib import Path

# Add parent directory to path to import logging_utils
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.logging_utils import setup_logging


def main():
    """
    Main entry point for the database validation helper.
    
    Parses command-line arguments and forwards them to the run_validator.py script
    with the appropriate configuration.
    
    Returns:
        int: Exit code (0 for success, non-zero for failures)
    """
    parser = argparse.ArgumentParser(description='Database Schema Validation Helper')
    parser.add_argument('--verbose', '-v', action='store_true', help='Include extra tables and columns in the report')
    parser.add_argument('--fix', '-f', action='store_true', help='Fix schema issues if possible')
    parser.add_argument('--db', help='Path to the SQLite database file')
    parser.add_argument('--schema', help='Path to the schema definition file')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    
    args = parser.parse_args()
    
    # Set up logging using the new logging_utils module
    logger = setup_logging('validate_db', args.debug)
    
    logger.info("Database Schema Validation Helper starting")
    
    # Build the command
    cmd = [sys.executable, 'run_validator.py', 'validate']
    
    if args.verbose:
        cmd.append('--include-extra')
    
    if args.fix:
        cmd.append('--fix')
    
    if args.db:
        cmd.extend(['--db-path', args.db])
    
    if args.schema:
        cmd.extend(['--schema-file', args.schema])
    
    if args.debug:
        cmd.append('--debug')
    
    # Run the command
    logger.debug(f"Running command: {' '.join(cmd)}")
    
    try:
        logger.info("Executing validator")
        subprocess.run(cmd, check=True)
        logger.info("Validation completed successfully")
        return 0
    except subprocess.CalledProcessError as e:
        logger.error(f"Validation failed with exit code {e.returncode}")
        return e.returncode
    except Exception as e:
        logger.error(f"Error executing validator: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return 1


if __name__ == '__main__':
    sys.exit(main()) 