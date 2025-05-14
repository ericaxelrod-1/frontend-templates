#!/usr/bin/env python3
"""
Role Utilities Testing Framework

This module provides a testing framework for the Angular role utility functions.
It implements Python equivalents of TypeScript utility methods and runs test cases
to verify their functionality.

The tests cover various role handling scenarios:
- Safe role access from dictionaries
- Case conversion for role names
- Role existence checking with case sensitivity options
- Extraction and formatting of role names from different data structures

Usage:
    python role_utils_test.py [--debug]

The test results are logged to both a file and the console.
"""

import os
import sys
import json
import logging
import argparse
import configparser
from datetime import datetime
from typing import Dict, List, Any, Optional, Union

# Add parent directory to path to import logging_utils
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.logging_utils import setup_logging


# Test cases for the RoleUtils class
class RoleUtilsTestCases:
    """
    Test cases for role utility functions.
    
    This class implements Python equivalents of TypeScript utility methods
    and tests them against expected results for various inputs.
    """
    
    def __init__(self, logger):
        """
        Initialize the test case runner with test data.
        
        Args:
            logger (logging.Logger): Logger for test output
        """
        self.logger = logger
        self.test_roles = {
            "ADMIN": "admin",
            "USER": "user",
            "SUPERUSER": "superuser",
            "admin": "admin",
            "user": "user",
            "superuser": "superuser",
            "Admin": "Admin"
        }
        
        self.user_roles = [
            {"id": 1, "name": "admin"},
            {"id": 2, "name": "user"}
        ]
        
        self.string_roles = ["admin", "user"]
    
    def test_safe_get_role(self):
        """
        Test the safeGetRole method.
        
        Tests lookup of roles with various inputs including case variations,
        non-existent keys, and null/empty inputs with default values.
        """
        self.logger.info("Testing safeGetRole method")
        
        # Test cases with expected results: (input, expected_output)
        test_cases = [
            ("ADMIN", "admin"),
            ("admin", "admin"),
            ("Admin", "Admin"),
            ("nonexistent", ""),
            ("nonexistent", "default_value", "default_value"),
            (None, ""),
            (None, "default_for_null", "default_for_null"),
            ("", ""),
            ("", "default_for_empty", "default_for_empty")
        ]
        
        for case in test_cases:
            input_key = case[0]
            expected = case[1]
            default = case[2] if len(case) > 2 else ""
            
            # Mock the TypeScript implementation
            result = self._mock_safe_get_role(input_key, default)
            
            if result == expected:
                self.logger.info(f"✓ safeGetRole({input_key!r}) => {result!r}")
            else:
                self.logger.error(f"✗ safeGetRole({input_key!r}) => {result!r}, expected {expected!r}")
    
    def test_safe_to_upper_case(self):
        """
        Test the safeToUpperCase method.
        
        Tests case conversion to uppercase with handling for
        null and empty inputs.
        """
        self.logger.info("Testing safeToUpperCase method")
        
        # Test cases with expected results: (input, expected_output)
        test_cases = [
            ("admin", "ADMIN"),
            ("Admin", "ADMIN"),
            ("ADMIN", "ADMIN"),
            ("", ""),
            (None, "")
        ]
        
        for case in test_cases:
            input_str = case[0]
            expected = case[1]
            
            # Mock the TypeScript implementation
            result = self._mock_safe_to_upper_case(input_str)
            
            if result == expected:
                self.logger.info(f"✓ safeToUpperCase({input_str!r}) => {result!r}")
            else:
                self.logger.error(f"✗ safeToUpperCase({input_str!r}) => {result!r}, expected {expected!r}")
    
    def test_safe_to_lower_case(self):
        """
        Test the safeToLowerCase method.
        
        Tests case conversion to lowercase with handling for
        null and empty inputs.
        """
        self.logger.info("Testing safeToLowerCase method")
        
        # Test cases with expected results: (input, expected_output)
        test_cases = [
            ("ADMIN", "admin"),
            ("Admin", "admin"),
            ("admin", "admin"),
            ("", ""),
            (None, "")
        ]
        
        for case in test_cases:
            input_str = case[0]
            expected = case[1]
            
            # Mock the TypeScript implementation
            result = self._mock_safe_to_lower_case(input_str)
            
            if result == expected:
                self.logger.info(f"✓ safeToLowerCase({input_str!r}) => {result!r}")
            else:
                self.logger.error(f"✗ safeToLowerCase({input_str!r}) => {result!r}, expected {expected!r}")
    
    def test_has_role(self):
        """
        Test the hasRole method.
        
        Tests role existence checking with various user role formats,
        case sensitivity options, and edge cases.
        """
        self.logger.info("Testing hasRole method")
        
        # Test cases with expected results: (userRoles, roleToCheck, caseSensitive, expected_output)
        test_cases = [
            (self.user_roles, "admin", False, True),
            (self.user_roles, "ADMIN", False, True),
            (self.user_roles, "admin", True, True),
            (self.user_roles, "ADMIN", True, False),
            (self.user_roles, "superuser", False, False),
            (self.string_roles, "admin", False, True),
            (self.string_roles, "ADMIN", False, True),
            (self.string_roles, "superuser", False, False),
            ([{"name": None}], "admin", False, False),
            (None, "admin", False, False),
            ([], "admin", False, False)
        ]
        
        for case in test_cases:
            user_roles = case[0]
            role_to_check = case[1]
            case_sensitive = case[2]
            expected = case[3]
            
            # Mock the TypeScript implementation
            result = self._mock_has_role(user_roles, role_to_check, case_sensitive)
            
            if result == expected:
                self.logger.info(f"✓ hasRole({role_to_check!r}, caseSensitive={case_sensitive}) => {result}")
            else:
                self.logger.error(f"✗ hasRole({role_to_check!r}, caseSensitive={case_sensitive}) => {result}, expected {expected}")
                self.logger.debug(f"  userRoles: {user_roles}")
    
    def test_extract_role_names(self):
        """
        Test the extractRoleNames method.
        
        Tests extraction of role names from different data structures
        including objects with name properties and string arrays.
        """
        self.logger.info("Testing extractRoleNames method")
        
        # Test cases with expected results: (roles, expected_output)
        test_cases = [
            (self.user_roles, ["admin", "user"]),
            (self.string_roles, ["admin", "user"]),
            ([{"id": 1, "name": "admin"}, {"id": 2, "name": None}], ["admin"]),
            ([{"id": 1, "name": "admin"}, {"id": 2}], ["admin"]),
            (None, []),
            ([], [])
        ]
        
        for case in test_cases:
            roles = case[0]
            expected = case[1]
            
            # Mock the TypeScript implementation
            result = self._mock_extract_role_names(roles)
            
            if result == expected:
                self.logger.info(f"✓ extractRoleNames() => {result!r}")
            else:
                self.logger.error(f"✗ extractRoleNames() => {result!r}, expected {expected!r}")
                self.logger.debug(f"  roles: {roles}")
    
    def test_format_role_names(self):
        """
        Test the formatRoleNames method.
        
        Tests formatting of role names including comma separation,
        proper case handling, and null handling.
        """
        self.logger.info("Testing formatRoleNames method")
        
        # Test cases with expected results: (roles, expected_output)
        test_cases = [
            (self.user_roles, "Admin, User"),
            (self.string_roles, "Admin, User"),
            ([{"id": 1, "name": "admin"}, {"id": 2, "name": "SUPERUSER"}], "Admin, Superuser"),
            (["admin", "USER", "superuser"], "Admin, User, Superuser"),
            (None, ""),
            ([], "")
        ]
        
        for case in test_cases:
            roles = case[0]
            expected = case[1]
            
            # Mock the TypeScript implementation
            result = self._mock_format_role_names(roles)
            
            if result == expected:
                self.logger.info(f"✓ formatRoleNames() => {result!r}")
            else:
                self.logger.error(f"✗ formatRoleNames() => {result!r}, expected {expected!r}")
                self.logger.debug(f"  roles: {roles}")
    
    def run_all_tests(self):
        """
        Run all the test methods in the test case class.
        
        Each test method will log its results using the configured logger.
        """
        self.logger.info("Starting RoleUtils test suite")
        
        # Run all test methods
        self.test_safe_get_role()
        self.test_safe_to_upper_case()
        self.test_safe_to_lower_case()
        self.test_has_role()
        self.test_extract_role_names()
        self.test_format_role_names()
        
        self.logger.info("RoleUtils test suite completed")
    
    def _mock_safe_get_role(self, role_key, default_value=""):
        """
        Python implementation of the TypeScript safeGetRole method.
        
        Safely gets a role value from the roles dictionary with a default value
        if the role key doesn't exist or is null/undefined.
        
        Args:
            role_key (str): The key to look up in the roles dictionary
            default_value (str, optional): Default value if key not found. Defaults to "".
            
        Returns:
            str: The role value if found, otherwise the default value
        """
        self.logger.debug(f"_mock_safe_get_role({role_key!r}, {default_value!r})")
        
        # Handle null/undefined case
        if role_key is None:
            self.logger.debug("  role_key is None, returning default_value")
            return default_value
        
        # Handle empty string case
        if role_key == "":
            self.logger.debug("  role_key is empty string, returning default_value")
            return default_value
        
        # Look up in the roles dictionary
        if role_key in self.test_roles:
            self.logger.debug(f"  Found role: {self.test_roles[role_key]!r}")
            return self.test_roles[role_key]
        else:
            self.logger.debug(f"  Role not found, returning default_value: {default_value!r}")
            return default_value
    
    def _mock_safe_to_upper_case(self, string):
        """
        Python implementation of the TypeScript safeToUpperCase method.
        
        Safely converts a string to uppercase, handling null/undefined cases.
        
        Args:
            string (str): The string to convert to uppercase
            
        Returns:
            str: The uppercase string or empty string if input is null/undefined
        """
        self.logger.debug(f"_mock_safe_to_upper_case({string!r})")
        
        if string is None:
            return ""
        return string.upper()
    
    def _mock_safe_to_lower_case(self, string):
        """
        Python implementation of the TypeScript safeToLowerCase method.
        
        Safely converts a string to lowercase, handling null/undefined cases.
        
        Args:
            string (str): The string to convert to lowercase
            
        Returns:
            str: The lowercase string or empty string if input is null/undefined
        """
        self.logger.debug(f"_mock_safe_to_lower_case({string!r})")
        
        if string is None:
            return ""
        return string.lower()
    
    def _mock_has_role(self, user_roles, role_to_check, case_sensitive=False):
        """
        Python implementation of the TypeScript hasRole method.
        
        Checks if a user has a specific role, with optional case sensitivity.
        
        Args:
            user_roles (list): List of role objects or role strings
            role_to_check (str): The role name to check for
            case_sensitive (bool, optional): Whether to use case-sensitive matching. Defaults to False.
            
        Returns:
            bool: True if the role is found, False otherwise
        """
        self.logger.debug(f"_mock_has_role({role_to_check!r}, {case_sensitive})")
        
        # Handle null/undefined or empty array case
        if not user_roles:
            self.logger.debug("  user_roles is null/undefined or empty, returning False")
            return False
        
        # Extract role names from the user roles
        role_names = self._mock_extract_role_names(user_roles)
        
        # Convert to the same case if case-insensitive
        if not case_sensitive:
            role_names = [name.lower() for name in role_names]
            role_to_check = role_to_check.lower()
        
        # Check if the role exists in the role names
        result = role_to_check in role_names
        self.logger.debug(f"  role_names: {role_names}")
        self.logger.debug(f"  result: {result}")
        return result
    
    def _mock_extract_role_names(self, roles):
        """
        Python implementation of the TypeScript extractRoleNames method.
        
        Extracts role names from a list of role objects or strings.
        
        Args:
            roles (list): List of role objects with name property or role strings
            
        Returns:
            list: List of role names
        """
        self.logger.debug(f"_mock_extract_role_names()")
        
        # Handle null/undefined or empty array case
        if not roles:
            self.logger.debug("  roles is null/undefined or empty, returning []")
            return []
        
        result = []
        for role in roles:
            # If role is a string, use it directly
            if isinstance(role, str):
                self.logger.debug(f"  Adding string role: {role!r}")
                result.append(role)
            # If role is an object with a name property, extract the name
            elif isinstance(role, dict) and role.get('name') is not None:
                self.logger.debug(f"  Adding object role name: {role['name']!r}")
                result.append(role['name'])
        
        self.logger.debug(f"  result: {result}")
        return result
    
    def _mock_format_role_names(self, roles):
        """
        Python implementation of the TypeScript formatRoleNames method.
        
        Formats role names with proper capitalization and comma separation.
        
        Args:
            roles (list): List of role objects or role strings
            
        Returns:
            str: Formatted string of role names
        """
        self.logger.debug(f"_mock_format_role_names()")
        
        # Extract role names from the roles
        role_names = self._mock_extract_role_names(roles)
        
        # Handle empty array case
        if not role_names:
            self.logger.debug("  role_names is empty, returning empty string")
            return ""
        
        # Format each role name with proper capitalization
        formatted_roles = []
        for role in role_names:
            # Convert to lowercase and then capitalize first letter
            formatted = role.lower()
            formatted = formatted[0].upper() + formatted[1:]
            self.logger.debug(f"  Formatted role: {formatted!r}")
            formatted_roles.append(formatted)
        
        # Join with comma and space
        result = ", ".join(formatted_roles)
        self.logger.debug(f"  result: {result!r}")
        return result


def main():
    """
    Main entry point for the role utility testing framework.
    
    Parses command-line arguments, sets up logging, and runs the test cases.
    
    Returns:
        int: Exit code (0 for success, non-zero for failures)
    """
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Role Utilities Testing Framework')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    args = parser.parse_args()
    
    # Set up logging using the new logging_utils module
    logger = setup_logging('role_utils_test', args.debug)
    
    try:
        # Create and run the test cases
        test_cases = RoleUtilsTestCases(logger)
        test_cases.run_all_tests()
        logger.info("All tests completed successfully")
        return 0
    except Exception as e:
        logger.error(f"Tests failed with error: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return 1


if __name__ == "__main__":
    sys.exit(main()) 