# Using Variables in Cursor Rules

This guide explains how to define and reference variables across Cursor rules (.mdc files) using a clear, consistent syntax.

## Introduction to Variables in Cursor Rules

There are two types of variables we can use in Cursor rules:

1. **Global Variables**: Built-in variables provided by Cursor
2. **Custom Variables**: User-defined variables using our custom syntax

## Global Variables in Cursor

Cursor provides these built-in variables that are automatically available in all rules:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `${projectName}` | Project name from package.json | "My Project" |
| `${projectVersion}` | Project version from package.json | "1.0.0" |
| `${projectRoot}` | Root directory of the project | "/path/to/project" |
| `${filePath}` | Full path of the current file | "/path/to/project/src/file.ts" |
| `${fileName}` | Name of the current file without extension | "file" |
| `${fileExt}` | Extension of the current file | "ts" |
| `${dirName}` | Name of the current directory | "src" |

## Custom Variable System

To create a clear system for defining and referencing custom variables across files, we'll use the following syntax:

### Step 1: Define Variables in a Central File

Create a central variables file at `.cursor/rules/000-variables.mdc`:

```markdown
---
description: "Central variable definitions for the project"
globs: [".cursor/rules/*.mdc"]
priority: 5
---

# Project Variables

## File Paths
-src_dir
 - src/
-docs_dir
 - docs/
-config_dir
 - config/
-tests_dir
 - tests/

## Key Files
-main_file
 - src/main.js
-config_file
 - config/settings.json
-readme_file
 - README.md
-changelog_file
 - CHANGELOG.md

## Project Settings
-node_version
 - 16.14.0
-deploy_target
 - production
-min_coverage
 - 80%
```

The syntax is:
- Variable definitions start with a hyphen and the variable name: `-variable_name`
- Values are indented and start with a hyphen: ` - value`
- Variable names cannot contain spaces
- Values can contain any characters, including spaces

### Step 2: Reference Variables in Other Rules

**IMPORTANT:** You MUST include a reference to your variables file using the `@` syntax at the top of any rule file that uses variables.

In other rule files, reference the variables file and use the `[variable_name]` syntax:

```markdown:.cursor/rules/coding-standards.mdc
---
description: "Coding standards for the project"
globs: ["**/*.js", "**/*.ts"]
---

# Coding Standards

@000-variables.mdc

## File Organization

- Source files should be placed in [src_dir]
- Tests should be placed in [tests_dir]
- Configuration should be centralized in [config_file]
- All code must be compatible with Node.js [node_version]

## Testing Requirements

- Test coverage must be at least [min_coverage] for all modules
- All tests must pass before deploying to [deploy_target]
```

## How This Works

When Claude sees a rule file that uses variables:

1. **Required**: The rule file MUST include `@000-variables.mdc` to explicitly reference the file containing variable definitions
2. Claude reads the variables defined in the referenced file
3. Claude recognizes variable references using the `[variable_name]` syntax
4. Claude replaces these references with the corresponding values

Without the explicit file reference, Claude cannot know where to find the variable definitions.

This approach is:
- Explicit and unambiguous
- Easy to parse for both humans and AI
- Compatible with Cursor's file reference system

## Combining Built-in and Custom Variables

You can combine both types of variables in your rules. Remember to always include the reference to your variables file:

```markdown
---
description: "Build configuration"
globs: ["**/*"]
---

# Build Configuration

@000-variables.mdc

## Build Process

1. Source files from `${projectRoot}/[src_dir]` are compiled to the dist/ directory
2. The main entry point is [main_file]
3. Running in [deploy_target] mode
```

## Best Practices

1. **Always include the variables file reference** - Every file that uses variables MUST include `@000-variables.mdc` (or your chosen file name)

2. **Use descriptive variable names** - Choose names that clearly indicate their purpose

3. **Group related variables** - Organize variables into logical sections

4. **Keep the variables file well-organized** - This makes it easier to find and update variables

5. **Be consistent with syntax** - Always use the same format for defining and referencing variables

6. **Document variable usage** - Add comments explaining complex variables or dependencies

## Example of Incorrect Usage

This will NOT work because it's missing the reference to the variables file:

```markdown
# INCORRECT - Missing the variables file reference
---
description: "Application configuration"
globs: ["**/*.config.js"]
---

# Application Configuration

## Settings
- The application should load [config_file] at startup
- Default environment is [deploy_target]
```

## Correct Usage

This will work because it includes the reference to the variables file:

```markdown
# CORRECT - Includes the variables file reference
---
description: "Application configuration" 
globs: ["**/*.config.js"]
---

# Application Configuration

@000-variables.mdc

## Settings
- The application should load [config_file] at startup
- Default environment is [deploy_target]
```

By following this approach, you can maintain consistent references across your Cursor rules and make your project more maintainable.