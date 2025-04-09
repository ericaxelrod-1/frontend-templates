#!/usr/bin/env python3
"""
DB Schema Validator - Main Entry Point
This script launches the database schema validation tools
"""

import os
import sys
import subprocess
from pathlib import Path

def main():
    """Main entry point for the schema validator"""
    # Find the actual db_tools.py script in the angular/scripts directory
    script_dir = Path(__file__).parent / "angular" / "scripts"
    tools_script = script_dir / "db_tools.py"
    
    if not tools_script.exists():
        print(f"ERROR: Could not find the tools script at {tools_script}")
        print("Make sure you have the complete set of schema validator scripts in the angular/scripts directory.")
        return 1
    
    # Check Python version
    if sys.version_info < (3, 6):
        print("This script requires Python 3.6 or higher")
        print(f"Current Python version: {sys.version}")
        return 1
    
    # Forward all arguments to the tools script
    cmd = [sys.executable, str(tools_script)] + sys.argv[1:]
    
    try:
        print(f"Launching DB Schema Validator...")
        result = subprocess.run(cmd)
        return result.returncode
    except Exception as e:
        print(f"Error running schema validator: {str(e)}")
        return 1

if __name__ == "__main__":
    sys.exit(main()) 