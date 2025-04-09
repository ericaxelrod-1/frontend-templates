#!/usr/bin/env python3
"""
Run Schema Validator Script
This script ensures all dependencies are installed and runs the schema validator
"""

import os
import sys
import subprocess
import platform
import argparse
from pathlib import Path

# Check for required Python version
if sys.version_info < (3, 6):
    print("This script requires Python 3.6 or higher")
    sys.exit(1)

def ensure_dependencies():
    """Ensure all required dependencies are installed"""
    # All dependencies are from the standard library, so no pip installs needed
    print("Checking Python environment...")
    print(f"Using Python {sys.version}")
    print("All dependencies are from the standard library. No additional packages needed.")
    return True

def find_script_path():
    """Find the path to the db_schema_validator.py script"""
    current_dir = Path(__file__).parent.absolute()
    validator_path = current_dir / "db_schema_validator.py"
    
    if not validator_path.exists():
        print(f"ERROR: Could not find the validator script at {validator_path}")
        sys.exit(1)
        
    return validator_path

def run_validator(args):
    """Run the schema validator with the provided arguments"""
    validator_path = find_script_path()
    
    # Build command with all passed arguments
    cmd = [sys.executable, str(validator_path)]
    
    # Add all arguments that were passed to this script
    if args.config:
        cmd.extend(["--config", args.config])
    if args.validate:
        cmd.append("--validate")
    if args.extract:
        cmd.append("--extract")
    if args.sync:
        cmd.append("--sync")
    if args.output:
        cmd.extend(["--output", args.output])
    if args.dry_run:
        cmd.append("--dry-run")
    if args.debug:
        cmd.append("--debug")
    
    # If no operation specified, default to validate
    if not any([args.validate, args.extract, args.sync]):
        cmd.append("--validate")
    
    print(f"Running command: {' '.join(cmd)}")
    
    # Run the validator and pass through the return code
    try:
        result = subprocess.run(cmd, check=False)
        return result.returncode
    except Exception as e:
        print(f"Error running validator: {str(e)}")
        return 1

def setup_logging():
    """Set up a log file for the run script itself"""
    import logging
    from datetime import datetime
    
    log_file = f"schema_validator_run_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler()
        ]
    )
    
    return logging.getLogger('schema_validator_runner')

def check_database_exists(args):
    """Check if the database file exists before running validation"""
    import json
    
    # Determine config file location
    config_path = args.config if args.config else Path(__file__).parent / "db_validator_config.json"
    
    # Default database path
    db_path = Path("angular/backend/data/dev.sqlite")
    
    # Load config file if it exists
    if Path(config_path).exists():
        try:
            with open(config_path, 'r') as f:
                config = json.load(f)
                if "db_path" in config:
                    db_path = Path(config["db_path"])
        except Exception as e:
            print(f"Warning: Failed to read config file: {e}")
    
    # Check if database exists
    if not db_path.exists():
        print(f"WARNING: Database file not found at {db_path}")
        print("If you are using --extract, this is fine. Otherwise, validation will fail.")
        
        # Only exit if we're not just extracting schema
        if args.validate or args.sync:
            print("Do you want to continue anyway? (y/n)")
            response = input().lower()
            if response != 'y':
                print("Exiting as requested.")
                sys.exit(0)

def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Run Database Schema Validator")
    parser.add_argument("--config", type=str, help="Path to config file")
    parser.add_argument("--validate", action="store_true", help="Validate schema")
    parser.add_argument("--extract", action="store_true", help="Extract schema from entities")
    parser.add_argument("--sync", action="store_true", help="Synchronize database schema")
    parser.add_argument("--output", type=str, help="Output file for extracted schema")
    parser.add_argument("--dry-run", action="store_true", help="Don't execute SQL statements")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    
    args = parser.parse_args()
    
    logger = setup_logging()
    logger.info("Starting schema validator runner")
    
    # Ensure all dependencies are installed
    if not ensure_dependencies():
        logger.error("Failed to ensure dependencies")
        return 1
    
    # Check if database exists
    check_database_exists(args)
    
    # Run the validator
    return_code = run_validator(args)
    
    logger.info(f"Schema validator completed with return code {return_code}")
    return return_code

if __name__ == "__main__":
    sys.exit(main()) 