#!/usr/bin/env python3
# Script to audit hardcoded access controls in the Angular codebase
# This script identifies files with hardcoded role names, role checks, and other access control issues
# Cross-platform compatible (Windows, Linux, MacOS)

import os
import re
import glob
import datetime
import subprocess
import sys
from pathlib import Path

# Configuration - updated paths to match actual project structure
backend_dir = Path("backend")
frontend_dir = Path("frontend")
report_file = Path("access-control-audit-report.md")

# Patterns to search for
role_definition_pattern = r"enum\s+.*Role|type\s+.*Role|interface\s+.*Role"
hardcoded_role_pattern = r"'ADMIN'|'USER'|'SUPERADMIN'|'PROJECT_MANAGER'|'SUPERUSER'"
role_decorator_pattern = r"@Roles\(|@HasRole\(|@RequireRoles\("
role_seed_pattern = r"createRole|insertRole|role:"
route_role_pattern = r"roles:|data:\s*{\s*roles"
template_role_pattern = r"\*ngIf=\".*role|\*ngIf=\".*hasRole|\*ngIf=\".*isAdmin"
component_role_pattern = r"user\.role|hasRole|roles\.includes|isAdmin\(|isSuperAdmin\("

def create_report():
    """Create the audit report file"""
    with open(report_file, 'w') as f:
        f.write(f"# Access Control Audit Report\n")
        f.write(f"Generated on {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")

def search_files(directory, pattern, file_ext="*.ts", exclude_pattern=None):
    """
    Search for pattern in files with the specified extension
    Returns a list of (file_path, line_number, line_text) tuples
    """
    results = []
    try:
        if not Path(directory).exists():
            print(f"Warning: Directory does not exist: {directory}")
            return results
            
        for path in Path(directory).rglob(file_ext):
            if exclude_pattern and re.search(exclude_pattern, str(path)):
                continue
                
            try:
                with open(path, 'r', encoding='utf-8') as file:
                    for i, line in enumerate(file.readlines(), 1):
                        if re.search(pattern, line):
                            results.append((str(path), i, line.strip()))
            except UnicodeDecodeError:
                print(f"Warning: Could not read {path} due to encoding issues.")
            except Exception as e:
                print(f"Error reading file {path}: {e}")
    except Exception as e:
        print(f"Error searching files: {e}")
    
    return results

def read_file_head(file_path, num_lines=20):
    """Read the first N lines of a file"""
    try:
        if not Path(file_path).exists():
            return [f"File not found: {file_path}"]
            
        with open(file_path, 'r', encoding='utf-8') as file:
            return [line.rstrip() for line in file.readlines()[:num_lines]]
    except Exception as e:
        return [f"Error reading file: {e}"]

def read_file(file_path):
    """Read a file's contents"""
    try:
        if not Path(file_path).exists():
            return f"File not found: {file_path}"
            
        with open(file_path, 'r', encoding='utf-8') as file:
            return file.read()
    except Exception as e:
        return f"Error reading file: {e}"

def extract_method(file_path, method_name, context_lines=30):
    """Extract a method and surrounding lines from a file"""
    try:
        if not Path(file_path).exists():
            return f"File not found: {file_path}"
            
        with open(file_path, 'r', encoding='utf-8') as file:
            content = file.read()
            pattern = rf"{method_name}\s*\("
            match = re.search(pattern, content)
            if match:
                start_pos = match.start()
                # Find start of the surrounding text
                excerpt_start = max(0, content.rfind('\n', 0, start_pos) - context_lines)
                excerpt_end = content.find('\n', start_pos + len(method_name) + context_lines)
                if excerpt_end == -1:
                    excerpt_end = len(content)
                return content[excerpt_start:excerpt_end]
            return f"Method '{method_name}' not found"
    except Exception as e:
        return f"Error extracting method: {e}"

def append_to_report(text):
    """Append text to the report file"""
    with open(report_file, 'a') as f:
        f.write(text)

def format_results(results):
    """Format search results into a string"""
    if not results:
        return "No results found."
        
    formatted = []
    for path, line_num, line_text in results:
        formatted.append(f"{path}:{line_num}: {line_text}")
    return '\n'.join(formatted)

def check_dir_exists(dir_path):
    """Check if directory exists and log if it doesn't"""
    if not Path(dir_path).exists():
        print(f"WARNING: Directory does not exist: {dir_path}")
        return False
    return True

def main():
    # Check if directories exist
    backend_exists = check_dir_exists(backend_dir)
    frontend_exists = check_dir_exists(frontend_dir)
    
    if not backend_exists and not frontend_exists:
        print("ERROR: Neither backend nor frontend directories exist. Check the paths.")
        return

    # Create report file
    create_report()
    append_to_report(f"**Backend Directory Path:** {backend_dir}\n")
    append_to_report(f"**Frontend Directory Path:** {frontend_dir}\n\n")
    
    # Backend hardcoded role definitions
    append_to_report("## 1. Backend Hardcoded Role Definitions\n\n")
    
    append_to_report("### 1.1 Role Enums and Type Definitions\n\n```\n")
    results = search_files(backend_dir, role_definition_pattern)
    append_to_report(format_results(results))
    append_to_report("\n```\n\n")
    
    append_to_report("### 1.2 Hardcoded Role Names\n\n```\n")
    results = search_files(backend_dir, hardcoded_role_pattern)
    append_to_report(format_results(results))
    append_to_report("\n```\n\n")
    
    append_to_report("### 1.3 Role-Based Guards and Decorators\n\n```\n")
    results = search_files(backend_dir, role_decorator_pattern)
    append_to_report(format_results(results))
    append_to_report("\n```\n\n")
    
    append_to_report("### 1.4 Seed Data and Migrations with Hardcoded Roles\n\n```\n")
    results = search_files(backend_dir, role_seed_pattern)
    append_to_report(format_results(results))
    append_to_report("\n```\n\n")
    
    # Critical file: role.entity.ts
    role_entity_path = backend_dir / "src" / "modules" / "users" / "entities" / "role.entity.ts"
    append_to_report(f"### 1.5 Critical File: role.entity.ts\n\n")
    append_to_report(f"**Location:** {role_entity_path}\n\n```typescript\n")
    append_to_report('\n'.join(read_file_head(role_entity_path)))
    append_to_report("\n```\n\n")
    
    # Frontend hardcoded access controls
    append_to_report("## 2. Frontend Hardcoded Access Controls\n\n")
    
    append_to_report("### 2.1 Route Definitions with Hardcoded Roles\n\n```\n")
    results = search_files(frontend_dir, route_role_pattern)
    append_to_report(format_results(results))
    append_to_report("\n```\n\n")
    
    append_to_report("### 2.2 Template Role Checks\n\n```\n")
    results = search_files(frontend_dir, template_role_pattern, file_ext="*.html")
    append_to_report(format_results(results))
    append_to_report("\n```\n\n")
    
    append_to_report("### 2.3 Component Role Checks\n\n```\n")
    results = search_files(frontend_dir, component_role_pattern, exclude_pattern=r"import ")
    append_to_report(format_results(results))
    append_to_report("\n```\n\n")
    
    # Critical files
    role_guard_path = frontend_dir / "src" / "app" / "core" / "guards" / "role.guard.ts"
    append_to_report(f"### 2.4 Critical File: role.guard.ts\n\n")
    append_to_report(f"**Location:** {role_guard_path}\n\n```typescript\n")
    append_to_report(read_file(role_guard_path))
    append_to_report("\n```\n\n")
    
    auth_service_path = frontend_dir / "src" / "app" / "core" / "services" / "auth.service.ts"
    append_to_report(f"### 2.5 Critical File: auth.service.ts (hasRole method)\n\n")
    append_to_report(f"**Location:** {auth_service_path}\n\n```typescript\n")
    append_to_report(extract_method(auth_service_path, "hasRole"))
    append_to_report("\n```\n\n")
    
    # Search for app.routes.ts
    append_to_report(f"### 2.6 Critical File: app.routes.ts\n\n")
    app_routes_path = frontend_dir / "src" / "app" / "app.routes.ts"
    append_to_report(f"**Location:** {app_routes_path}\n\n```typescript\n")
    append_to_report(read_file(app_routes_path))
    append_to_report("\n```\n\n")
    
    # Summary of findings
    append_to_report("## 3. Summary of Findings\n\n")
    
    backend_count = len(search_files(backend_dir, hardcoded_role_pattern))
    frontend_ts_count = len(search_files(frontend_dir, hardcoded_role_pattern))
    frontend_html_count = len(search_files(frontend_dir, template_role_pattern, file_ext="*.html"))
    route_count = len(search_files(frontend_dir, route_role_pattern))
    
    total_count = backend_count + frontend_ts_count + frontend_html_count
    
    append_to_report("| Category | Count |\n")
    append_to_report("|----------|-------|\n")
    append_to_report(f"| Backend Hardcoded Roles | {backend_count} |\n")
    append_to_report(f"| Frontend TypeScript Hardcoded Roles | {frontend_ts_count} |\n")
    append_to_report(f"| Frontend Template Role Checks | {frontend_html_count} |\n")
    append_to_report(f"| Route Definitions with Roles | {route_count} |\n")
    append_to_report(f"| **Total Hardcoded Instances** | **{total_count}** |\n\n")
    
    # Critical files requiring migration
    append_to_report("## 4. Critical Files Requiring Migration\n\n")
    append_to_report(f"1. {backend_dir}/src/modules/users/entities/role.entity.ts\n")
    append_to_report(f"2. {frontend_dir}/src/app/core/guards/role.guard.ts\n")
    append_to_report(f"3. {frontend_dir}/src/app/core/services/auth.service.ts\n")
    append_to_report(f"4. {frontend_dir}/src/app/app.routes.ts\n")
    append_to_report(f"5. {frontend_dir}/src/app/modules/admin/admin.module.ts\n\n")
    
    # Next steps
    append_to_report("## 5. Next Steps\n\n")
    append_to_report("1. Create database schema changes for hierarchical roles and groups\n")
    append_to_report("2. Implement permission entities and services\n")
    append_to_report("3. Update role.entity.ts to use database-driven approach\n")
    append_to_report("4. Create permission-based guards to replace role-based guards\n")
    append_to_report("5. Develop frontend permission services and directives\n")
    append_to_report("6. Migrate all hardcoded instances to use the new permission system\n\n")
    
    print(f"Report generated: {report_file}")
    print(f"Found {total_count} total hardcoded access control instances")

if __name__ == "__main__":
    main() 