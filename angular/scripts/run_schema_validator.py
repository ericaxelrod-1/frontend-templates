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
import logging
import json
from datetime import datetime
from pathlib import Path

# Check for required Python version
if sys.version_info < (3, 6):
    print("This script requires Python 3.6 or higher")
    sys.exit(1)

def get_workspace_root():
    """Get the absolute path to the workspace root"""
    return Path(__file__).resolve().parent.parent.parent

def resolve_path(path_str, relative_to_workspace=True):
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

def ensure_dependencies():
    """Ensure all required dependencies are installed"""
    print("Checking Python environment...")
    print(f"Using Python {sys.version}")
    print("All dependencies are from the standard library. No additional packages needed.")
    return True

def find_script_path():
    """Find the path to the db_schema_validator.py script"""
    validator_path = resolve_path("db_schema_validator.py", relative_to_workspace=False)
    
    if not validator_path.exists():
        print(f"ERROR: Could not find the validator script at {validator_path}")
        sys.exit(1)
        
    return validator_path

def setup_logging(debug=False):
    """Set up a log file for the run script itself"""
    log_file_name = f"schema_validator_run_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    log_file_path = resolve_path(log_file_name, relative_to_workspace=False)

    log_level = logging.DEBUG if debug else logging.INFO
    
    logging.basicConfig(
        level=log_level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file_path),
            logging.StreamHandler()
        ]
    )
    
    logger = logging.getLogger('schema_validator_runner')
    logger.debug(f"Log file created at: {log_file_path}")
    logger.debug(f"Workspace root: {get_workspace_root()}")
    return logger

def load_config(config_path):
    """Load and validate the configuration file"""
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
            
        required_fields = ['entities_path', 'db_path', 'schema_file']
        missing_fields = [field for field in required_fields if field not in config]
        
        if missing_fields:
            raise ValueError(f"Missing required fields in config: {', '.join(missing_fields)}")
            
        return config
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in config file: {e}")
    except Exception as e:
        raise ValueError(f"Error reading config file: {e}")

def check_database_exists(config_path, args, logger):
    """Check if the database file exists before running validation"""
    try:
        config = load_config(config_path)
        db_path = resolve_path(config['db_path'])
        
        logger.info(f"Checking database at: {db_path}")
        
        if not db_path.exists():
            error_msg = f"Database file not found at: {db_path}"
            logger.error(error_msg)
            
            if args.validate or args.sync:
                if args.non_interactive:
                    logger.error("Exiting due to --non-interactive mode and missing database for validate/sync.")
                    sys.exit(1)
                else:
                    print(f"\n{error_msg}")
                    print("This is required for validation or synchronization.")
                    print("Do you want to continue anyway? (y/n)")
                    response = input().lower()
                    if response != 'y':
                        logger.info("User chose to exit.")
                        sys.exit(0)
            else:
                logger.warning("Database not found, but continuing as operation may not require it.")
        else:
            logger.info("Database file found and accessible.")
            
    except Exception as e:
        logger.error(f"Error checking database: {e}")
        if args.non_interactive:
            sys.exit(1)
        raise

def run_validator(args, logger):
    """Run the schema validator with the provided arguments"""
    try:
        validator_path = find_script_path()
        workspace_root = get_workspace_root()
        
        # Build command
        cmd = [sys.executable, str(validator_path)]
        
        # Resolve config path
        if args.config:
            config_path = Path(args.config)
            if not config_path.is_absolute():
                config_path = workspace_root / config_path
        else:
            config_path = resolve_path("db_validator_config.json", relative_to_workspace=False)
        
        cmd.extend(["--config", str(config_path)])
        
        # Add operation flags
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
        if args.non_interactive:
            cmd.append("--non-interactive")
            
        # Default to validate if no operation specified
        if not any([args.validate, args.extract, args.sync]):
            cmd.append("--validate")
        
        logger.debug(f"Running command: {' '.join(cmd)}")
        logger.debug(f"Working directory: {workspace_root}")
        
        # Run validator from workspace root
        result = subprocess.run(
            cmd,
            check=False,
            cwd=workspace_root,
            capture_output=True,
            text=True
        )
        
        # Log output
        if result.stdout:
            logger.debug("Validator stdout:")
            for line in result.stdout.splitlines():
                logger.debug(line)
                
        if result.stderr:
            logger.error("Validator stderr:")
            for line in result.stderr.splitlines():
                logger.error(line)
        
        if result.returncode != 0:
            logger.error(f"Validator failed with return code {result.returncode}")
        else:
            logger.info("Validator completed successfully")
            
        return result.returncode
        
    except Exception as e:
        logger.error(f"Error running validator: {str(e)}")
        if args.non_interactive:
            sys.exit(1)
        return 1

def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Run Database Schema Validator")
    parser.add_argument("--config", type=str, help="Path to config file. If not provided, uses default db_validator_config.json in script's directory.")
    parser.add_argument("--validate", action="store_true", help="Validate schema")
    parser.add_argument("--extract", action="store_true", help="Extract schema from entities")
    parser.add_argument("--sync", action="store_true", help="Synchronize database schema")
    parser.add_argument("--output", type=str, help="Output file for extracted schema")
    parser.add_argument("--dry-run", action="store_true", help="Don't execute SQL statements")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    parser.add_argument("--non-interactive", action="store_true", help="Run in non-interactive mode, fail on errors")
    
    args = parser.parse_args()
    
    try:
        # Setup logging first
        logger = setup_logging(args.debug)
        logger.info("Starting schema validator runner")
        logger.debug(f"Arguments: {args}")
        
        # Ensure dependencies
        if not ensure_dependencies():
            logger.error("Failed to ensure dependencies")
            return 1
        
        # Resolve config path
        if args.config:
            config_path = Path(args.config)
            if not config_path.is_absolute():
                config_path = get_workspace_root() / config_path
        else:
            config_path = resolve_path("db_validator_config.json", relative_to_workspace=False)
            
        # Check database
        check_database_exists(config_path, args, logger)
        
        # Run validator
        return_code = run_validator(args, logger)
        
        logger.info(f"Schema validator completed with return code {return_code}")
        return return_code
        
    except Exception as e:
        if args.debug:
            logger.exception("Unhandled exception:")
        else:
            logger.error(f"Error: {str(e)}")
        return 1

if __name__ == "__main__":
    sys.exit(main()) 