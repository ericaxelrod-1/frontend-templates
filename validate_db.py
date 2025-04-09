#!/usr/bin/env python3
"""
Simple script to run the database schema validator with commonly used options
"""

import os
import sys
import argparse
import subprocess

def main():
    parser = argparse.ArgumentParser(description='Database Schema Validation Helper')
    parser.add_argument('--verbose', '-v', action='store_true', help='Include extra tables and columns in the report')
    parser.add_argument('--fix', '-f', action='store_true', help='Fix schema issues if possible')
    parser.add_argument('--db', help='Path to the SQLite database file')
    parser.add_argument('--schema', help='Path to the schema definition file')
    
    args = parser.parse_args()
    
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
    
    # Run the command
    try:
        subprocess.run(cmd, check=True)
        return 0
    except subprocess.CalledProcessError as e:
        return e.returncode

if __name__ == '__main__':
    sys.exit(main()) 