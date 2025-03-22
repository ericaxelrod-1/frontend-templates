# Development Tools

This directory contains utility scripts and tools to help ensure code quality and best practices during development.

## Available Tools

### Duplicate CSS Checker
**File**: `check-duplicate-css.js`

Scans all SCSS files in the project to find duplicate CSS selectors that might cause specificity issues or styling conflicts.

```bash
npm run check:duplicate-css
```

### Material Theme Validator
**File**: `validate-material-theme.js`

Validates Angular Material theme configuration to ensure proper setup and usage.

```bash
npm run check:material-theme
```

### Layout Nesting Checker
**File**: `check-layout-nesting.js`

Detects potential layout nesting issues by scanning for instances of layouts used within other layouts, which can lead to UI problems.

```bash
npm run check:layout-nesting
```

## Running the Tools

### Individual Tool
To run a specific tool:

```bash
node tools/check-duplicate-css.js
```

### Verify All
To run all verification tools:

```bash
npm run verify
```

## Adding New Tools

When adding a new tool to this directory:

1. Create a JavaScript file with clear console output (use the helper functions for consistent styling)
2. Add a script entry in `package.json`
3. Document the tool in this README
4. Update the `verify` script if the tool should be part of the verification process

## Tool Development Guidelines

1. Each tool should provide clear output with color-coded messages
2. Include recommendations for fixing detected issues
3. Use proper exit codes (0 for success/warnings, 1 for errors)
4. Document the purpose and usage in this README
5. Tools should be efficient and focus on a specific aspect of code quality 