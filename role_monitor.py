#!/usr/bin/env python3
"""
Role Monitor - Angular Role Usage Analysis Tool

This module analyzes Angular/TypeScript code to identify potentially problematic
patterns in role-based access control implementation. It helps identify hard-coded
role references, improper role comparisons, and other issues that could make
the application less maintainable or secure.

The tool scans frontend and backend TypeScript files, generates detailed reports
of issues found, and logs information for further analysis.

Usage:
    python role_monitor.py [--debug]

Configuration:
    Configuration is stored in role_monitor_config.ini with these parameters:
    - LogDirectory: Directory for storing log files
    - DebugMode: Whether to enable verbose debug logging
    - AngularFrontendDir: Path to the Angular frontend code
    - AngularBackendDir: Path to the Angular backend code
"""

import os
import re
import json
import logging
import argparse
from datetime import datetime
import configparser
import sys

# Add parent directory to path to import logging_utils
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.logging_utils import setup_logging

# Setup configuration
def setup_config():
    """
    Set up configuration for the role monitor.
    
    Creates a default configuration file if none exists, or loads the existing configuration.
    
    Returns:
        configparser.ConfigParser: The loaded configuration object
    """
    config = configparser.ConfigParser()
    
    # Default configuration
    config['DEFAULT'] = {
        'LogDirectory': '.',
        'DebugMode': 'False',
        'AngularFrontendDir': 'angular/frontend',
        'AngularBackendDir': 'angular/backend'
    }
    
    # Create config file if it doesn't exist
    if not os.path.exists('role_monitor_config.ini'):
        with open('role_monitor_config.ini', 'w') as configfile:
            config.write(configfile)
    else:
        config.read('role_monitor_config.ini')
    
    return config

def scan_typescript_files(root_dir, issue_patterns, logger):
    """
    Scan TypeScript files for potential role-related issues.
    
    Recursively searches through the specified directory for TypeScript files
    and analyzes them against the provided regex patterns to identify issues.
    
    Args:
        root_dir (str): The root directory to start scanning from
        issue_patterns (dict): Dictionary of pattern names to regex patterns to search for
        logger (logging.Logger): Logger for tracking progress and issues
        
    Returns:
        list: List of dictionaries containing issue details (file, line, issue type, content, matches)
    """
    issues_found = []
    
    for root, _, files in os.walk(root_dir):
        for file in files:
            if file.endswith('.ts'):
                file_path = os.path.join(root, file)
                relative_path = os.path.relpath(file_path, os.getcwd())
                
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                        line_number = 1
                        
                        for line in content.split('\n'):
                            for pattern_name, pattern in issue_patterns.items():
                                matches = re.findall(pattern, line)
                                if matches:
                                    issues_found.append({
                                        'file': relative_path,
                                        'line': line_number,
                                        'issue_type': pattern_name,
                                        'content': line.strip(),
                                        'matches': matches
                                    })
                            line_number += 1
                except Exception as e:
                    logger.error(f"Error processing file {file_path}: {str(e)}")
    
    return issues_found

def analyze_roles_files(config, logger):
    """
    Analyze roles-related files for specific issues.
    
    Scans frontend and backend directories for TypeScript files,
    looking for patterns that indicate potential role-related issues.
    
    Args:
        config (configparser.ConfigParser): Configuration containing directory paths
        logger (logging.Logger): Logger for reporting progress and issues
        
    Returns:
        list: Combined list of all issues found in frontend and backend
    """
    frontend_dir = config['DEFAULT']['AngularFrontendDir']
    backend_dir = config['DEFAULT']['AngularBackendDir']
    
    logger.debug(f"Frontend directory: {frontend_dir}")
    logger.debug(f"Backend directory: {backend_dir}")
    
    # Patterns to look for in the codebase
    issue_patterns = {
        'nullable_access': r'(\w+)(?:\?|\|\s*null|\|\s*undefined)\.toUpperCase\(\)',
        'undefined_role_access': r'SystemRoles\[(.*?)\]',
        'direct_role_comparison': r'(role|userRole)\s*(===|==|!==|!=)\s*["\'](.*?)["\']',
        'role_transformation': r'\.toUpperCase\(\)'
    }
    
    logger.debug("Scanning for role-related issues with patterns:")
    for pattern_name, pattern in issue_patterns.items():
        logger.debug(f"  {pattern_name}: {pattern}")
    
    # Find issues
    frontend_issues = scan_typescript_files(frontend_dir, issue_patterns, logger)
    backend_issues = scan_typescript_files(backend_dir, issue_patterns, logger)
    
    # Log findings
    if frontend_issues:
        logger.info(f"Found {len(frontend_issues)} potential role-related issues in frontend code")
        for issue in frontend_issues:
            logger.debug(f"{issue['file']}:{issue['line']} - {issue['issue_type']} - {issue['content']}")
    else:
        logger.info("No role-related issues found in frontend code")
        
    if backend_issues:
        logger.info(f"Found {len(backend_issues)} potential role-related issues in backend code")
        for issue in backend_issues:
            logger.debug(f"{issue['file']}:{issue['line']} - {issue['issue_type']} - {issue['content']}")
    else:
        logger.info("No role-related issues found in backend code")
    
    # Save detailed results to JSON file
    all_issues = frontend_issues + backend_issues
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    result_file = f'role_issues_{timestamp}.json'
    
    with open(result_file, 'w') as f:
        json.dump(all_issues, f, indent=2)
        
    logger.info(f"Detailed report saved to {result_file}")
    
    return all_issues

def main():
    """
    Main entry point for the role monitor script.
    
    Parses command line arguments, sets up configuration and logging,
    and runs the roles analysis.
    
    Returns:
        int: Exit code (0 for success, non-zero for failures)
    """
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Role Monitor for Angular applications')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    args = parser.parse_args()
    
    # Set up config
    config = setup_config()
    
    # Set up logging using the new logging_utils module
    logger = setup_logging('role_monitor', args.debug)
    
    try:
        # Run analysis
        logger.info("Starting role monitor analysis")
        issues = analyze_roles_files(config, logger)
        
        # Print summary
        logger.info(f"Analysis complete. Found {len(issues)} potential role-related issues.")
        logger.info("Check the generated JSON file for detailed information.")
        
        return 0
    except Exception as e:
        logger.error(f"Error during role monitoring: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return 1

if __name__ == "__main__":
    sys.exit(main()) 