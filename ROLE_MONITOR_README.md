# Role Monitor Tool

## Overview
The Role Monitor is a Python-based utility designed to scan your Angular codebase for potential issues related to role handling, particularly focusing on problems like:

1. Nullable references that attempt to call `toUpperCase()`
2. Undefined role access in the SystemRoles object
3. Direct role string comparisons (which are prone to errors)
4. Potentially unsafe role transformations

## Installation

### Prerequisites
- Python 3.6 or higher
- Access to the Angular project codebase

### Dependencies
This tool uses only Python standard library packages, so no additional dependencies are required.

## Configuration
The tool uses a configuration file `role_monitor_config.ini` which will be automatically created on first run with default values:

```ini
[DEFAULT]
LogDirectory = .
DebugMode = False
AngularFrontendDir = angular/frontend
AngularBackendDir = angular/backend
```

You can modify this file to customize:
- `LogDirectory`: Directory where log files will be stored
- `DebugMode`: Set to `True` to enable verbose logging
- `AngularFrontendDir`: Path to the Angular frontend code
- `AngularBackendDir`: Path to the Angular backend code

## Usage

### Basic Usage
Run the script from the command line:

```
python role_monitor.py
```

### Enable Debug Mode
To enable debug mode (verbose logging):

```
python role_monitor.py --debug
```

## Output
The tool generates two output files:

1. **Log file**: `role_monitor_YYYYMMDD_HHMMSS.log` - Contains execution information and a summary of findings
2. **Results file**: `role_issues_YYYYMMDD_HHMMSS.json` - Detailed JSON report of all identified issues

## Understanding Results
The results JSON file contains an array of issue objects, each with the following properties:

- `file`: Relative path to the file where the issue was found
- `line`: Line number where the issue was detected
- `issue_type`: Type of issue (one of the patterns being searched for)
- `content`: The line content where the issue was found
- `matches`: Specific matches found in the line according to the pattern

## Issue Types

### nullable_access
Identifies potentially unsafe calls to `toUpperCase()` on properties that might be null or undefined.

Example problematic code:
```typescript
const role = user?.role.toUpperCase(); // Will crash if user exists but role is null
```

### undefined_role_access
Identifies potentially unsafe accesses to the SystemRoles collection where the key might not exist.

Example problematic code:
```typescript
const role = SystemRoles[someVariable]; // Will be undefined if key doesn't exist
```

### direct_role_comparison
Identifies direct string comparisons with role values, which can be error-prone.

Example problematic code:
```typescript
if (userRole === 'ADMIN') { // Case-sensitive comparison issues
```

### role_transformation
Identifies calls to `toUpperCase()` which may indicate inconsistent handling of case in roles.

Example problematic code:
```typescript
if (role.toUpperCase() === 'ADMIN') { // Inconsistent case handling
```

## Recommended Fixes

1. **For nullable_access issues**:
   - Use optional chaining with nullish coalescing: `user?.role?.toUpperCase() ?? 'DEFAULT_ROLE'`
   - Check for null/undefined before transformations: `user && user.role ? user.role.toUpperCase() : 'DEFAULT_ROLE'`

2. **For undefined_role_access issues**:
   - Use optional chaining: `SystemRoles?.[key]`
   - Use hasOwnProperty checks: `SystemRoles.hasOwnProperty(key) ? SystemRoles[key] : defaultValue`

3. **For direct_role_comparison issues**:
   - Use constants instead of string literals
   - Consider case-insensitive comparisons when appropriate

4. **For role_transformation issues**:
   - Standardize on a consistent case format throughout the application
   - Consider using role constants or enums instead of strings

## Contributing
Feel free to enhance this tool with additional patterns or improved detection logic.

## License
This tool is provided as-is with no warranty. Use at your own risk. 