#!/usr/bin/env python3
"""
Migration script for transitioning from hardcoded role-based access control
to a dynamic permission-based system.

This script helps with:
1. Identifying hardcoded role checks
2. Creating necessary migration files
3. Applying database schema changes
4. Updating code to use the new permission system
"""

import os
import re
import sys
import argparse
import shutil
from pathlib import Path
import subprocess
import json

# Configuration
BACKEND_DIR = Path("../backend")
FRONTEND_DIR = Path("../frontend")
MIGRATION_DIR = Path(".")

def setup_argparse():
    """Setup command line arguments"""
    parser = argparse.ArgumentParser(description="Migration script for role-based to permission-based access control")
    
    # Main commands
    subparsers = parser.add_subparsers(dest='command', help='Commands')
    
    # Audit command
    audit_parser = subparsers.add_parser('audit', help='Audit existing role checks')
    audit_parser.add_argument('--output', default='access-control-audit-report.md', help='Output file for audit results')
    
    # Schema command
    schema_parser = subparsers.add_parser('schema', help='Apply database schema changes')
    schema_parser.add_argument('--db-type', choices=['postgres', 'mysql'], default='postgres', help='Database type')
    schema_parser.add_argument('--db-name', help='Database name')
    schema_parser.add_argument('--db-user', help='Database username')
    schema_parser.add_argument('--db-password', help='Database password')
    
    # Backend command
    backend_parser = subparsers.add_parser('backend', help='Migrate backend code')
    backend_parser.add_argument('--dry-run', action='store_true', help='Show changes without applying them')
    
    # Frontend command
    frontend_parser = subparsers.add_parser('frontend', help='Migrate frontend code')
    frontend_parser.add_argument('--dry-run', action='store_true', help='Show changes without applying them')
    
    # Files command
    files_parser = subparsers.add_parser('files', help='Copy migration files to their destinations')
    files_parser.add_argument('--dry-run', action='store_true', help='Show changes without applying them')
    
    return parser.parse_args()

def audit_codebase(output_file):
    """Audit the codebase for hardcoded role checks"""
    # Use the standalone audit script
    audit_script = Path("../scripts/audit_access_controls.py")
    
    if not audit_script.exists():
        print(f"Error: Audit script not found at {audit_script}")
        return False
    
    try:
        print(f"Running audit script...")
        result = subprocess.run(
            [sys.executable, str(audit_script)],
            capture_output=True,
            text=True,
            check=True
        )
        print(result.stdout)
        
        if result.returncode == 0:
            print(f"Audit completed successfully. Results saved to {output_file}")
            return True
        else:
            print(f"Error: Audit script failed with code {result.returncode}")
            print(result.stderr)
            return False
    except subprocess.CalledProcessError as e:
        print(f"Error executing audit script: {e}")
        return False

def apply_schema_changes(db_type, db_name, db_user, db_password):
    """Apply database schema changes"""
    schema_file = MIGRATION_DIR / "role-permission-schema.sql"
    
    if not schema_file.exists():
        print(f"Error: Schema file not found at {schema_file}")
        return False
    
    print(f"Applying schema changes from {schema_file}...")
    
    if db_type == 'postgres':
        # PostgreSQL
        try:
            env = os.environ.copy()
            if db_password:
                env['PGPASSWORD'] = db_password
            
            cmd = ['psql']
            if db_user:
                cmd.extend(['-U', db_user])
            if db_name:
                cmd.extend(['-d', db_name])
            cmd.extend(['-f', str(schema_file)])
            
            result = subprocess.run(
                cmd,
                env=env,
                capture_output=True,
                text=True,
                check=True
            )
            print(result.stdout)
            return True
        except subprocess.CalledProcessError as e:
            print(f"Error applying PostgreSQL schema: {e}")
            print(e.stderr)
            return False
    elif db_type == 'mysql':
        # MySQL
        try:
            cmd = ['mysql']
            if db_user:
                cmd.extend(['-u', db_user])
            if db_password:
                cmd.extend(['-p' + db_password])
            if db_name:
                cmd.append(db_name)
            cmd.extend(['<', str(schema_file)])
            
            # For MySQL, we need to use shell=True due to the redirect
            result = subprocess.run(
                ' '.join(cmd),
                shell=True,
                capture_output=True,
                text=True,
                check=True
            )
            print(result.stdout)
            return True
        except subprocess.CalledProcessError as e:
            print(f"Error applying MySQL schema: {e}")
            print(e.stderr)
            return False
    else:
        print(f"Unsupported database type: {db_type}")
        return False

def migrate_backend(dry_run=False):
    """Migrate backend code"""
    # Map of files to copy
    files_to_copy = {
        "permissions.controller.ts": BACKEND_DIR / "src" / "modules" / "users" / "permissions.controller.ts",
        # Add more files as needed
    }
    
    if dry_run:
        print("Dry run: Would copy the following files:")
        for src, dest in files_to_copy.items():
            print(f"  {MIGRATION_DIR / src} -> {dest}")
        return True
    
    # Copy files
    for src, dest in files_to_copy.items():
        src_path = MIGRATION_DIR / src
        if not src_path.exists():
            print(f"Warning: Source file {src_path} does not exist")
            continue
        
        # Create directories if they don't exist
        dest.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            shutil.copy2(src_path, dest)
            print(f"Copied {src_path} to {dest}")
        except Exception as e:
            print(f"Error copying {src_path} to {dest}: {e}")
    
    print("Backend migration completed")
    return True

def migrate_frontend(dry_run=False):
    """Migrate frontend code"""
    # Map of files to copy
    files_to_copy = {
        "permission.guard.ts": FRONTEND_DIR / "src" / "app" / "core" / "guards" / "permission.guard.ts",
        "permission.service.ts": FRONTEND_DIR / "src" / "app" / "core" / "services" / "permission.service.ts",
        "has-permission.directive.ts": FRONTEND_DIR / "src" / "app" / "core" / "directives" / "has-permission.directive.ts",
        # Add more files as needed
    }
    
    if dry_run:
        print("Dry run: Would copy the following files:")
        for src, dest in files_to_copy.items():
            print(f"  {MIGRATION_DIR / src} -> {dest}")
        return True
    
    # Copy files
    for src, dest in files_to_copy.items():
        src_path = MIGRATION_DIR / src
        if not src_path.exists():
            print(f"Warning: Source file {src_path} does not exist")
            continue
        
        # Create directories if they don't exist
        dest.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            shutil.copy2(src_path, dest)
            print(f"Copied {src_path} to {dest}")
        except Exception as e:
            print(f"Error copying {src_path} to {dest}: {e}")
    
    print("Frontend migration completed")
    return True

def copy_migration_files(dry_run=False):
    """Copy all migration files to their destinations"""
    success = True
    
    if not migrate_backend(dry_run):
        success = False
    
    if not migrate_frontend(dry_run):
        success = False
    
    return success

def main():
    args = setup_argparse()
    
    if args.command == 'audit':
        if not audit_codebase(args.output):
            sys.exit(1)
    elif args.command == 'schema':
        if not apply_schema_changes(args.db_type, args.db_name, args.db_user, args.db_password):
            sys.exit(1)
    elif args.command == 'backend':
        if not migrate_backend(args.dry_run):
            sys.exit(1)
    elif args.command == 'frontend':
        if not migrate_frontend(args.dry_run):
            sys.exit(1)
    elif args.command == 'files':
        if not copy_migration_files(args.dry_run):
            sys.exit(1)
    else:
        print("No command specified. Use --help for usage information.")
        sys.exit(1)
    
    sys.exit(0)

if __name__ == "__main__":
    main() 