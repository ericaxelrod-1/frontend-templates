# Advanced Features in Cursor Rules

This guide covers advanced features available in Cursor rules, including XML tags, variables, and file references.

## XML Tags in Cursor Rules

XML tags provide special formatting and functionality in your Cursor rules. They allow you to structure information in a way that the AI can more easily interpret and apply.

### Basic XML Tag Structure

XML tags in Cursor rules follow this format:

```
<tagname [attributes]>
Content goes here
</tagname>
```

### Common XML Tags

#### `<example>` Tag

The most commonly used XML tag is the `<example>` tag, which helps provide concrete examples of code patterns:

```
<example>
// Good example
function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}
</example>

<example type="invalid">
// Bad example - avoid this
function calculateTotal(items) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total = total + items[i].price;
  }
  return total;
}
</example>
```

**Attributes:**
- `type`: Can be "valid" (default), "invalid", or "warning"
- `language`: Specifies the language for syntax highlighting (e.g., "typescript", "python")
- `label`: A descriptive label for the example

#### `<pattern>` Tag

Used to define code patterns that should be followed or avoided:

```
<pattern type="match">
import { Component } from '@angular/core';
</pattern>

<pattern type="avoid">
import * as Angular from '@angular/core';
</pattern>
```

**Attributes:**
- `type`: "match" (recommended pattern) or "avoid" (pattern to avoid)
- `severity`: "error", "warning", or "info"

#### `<note>` Tag

Used for important callouts or additional information:

```
<note type="warning">
Always validate user input before processing to prevent security vulnerabilities.
</note>
```

**Attributes:**
- `type`: "info", "warning", "error", or "tip"

### When to Use XML Tags

Use XML tags when:

1. **Providing examples**: Use `<example>` to clearly demonstrate code practices
2. **Highlighting patterns**: Use `<pattern>` to define specific code patterns
3. **Adding emphasis**: Use `<note>` for important warnings or tips
4. **Structuring complex information**: Use custom tags for specialized content

### Practical Examples

#### Component Structure Example

```
## React Component Structure

<example language="tsx">
// Preferred component structure
import React from 'react';
import styles from './Component.module.css';

interface ComponentProps {
  title: string;
}

export const Component: React.FC<ComponentProps> = ({ title }) => {
  return <div className={styles.container}>{title}</div>;
};
</example>
```

#### API Usage Example

```
## API Call Pattern

<example language="typescript">
// Recommended API call pattern
async function fetchData(endpoint: string): Promise<Data> {
  try {
    const response = await fetch(`/api/${endpoint}`);
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch data:', error);
    throw error;
  }
}
</example>
```

## Variables in Cursor Rules

Variables in Cursor rules allow for dynamic content that can adapt based on the context. They can reference project-specific values or be used as placeholders.

### Variable Syntax

Variables in Cursor rules use the `${variable}` syntax:

```
Use `${projectName}` as the namespace for all components.
```

### Common Variable Types

#### Project Variables

These reference information about the current project:

- `${projectName}`: The name of the project (from package.json or similar)
- `${projectVersion}`: The current version of the project
- `${projectAuthor}`: The author of the project

#### Path Variables

These help with file and directory references:

- `${filePath}`: The path of the current file
- `${fileName}`: The name of the current file
- `${fileExt}`: The extension of the current file
- `${dirName}`: The name of the current directory

#### Custom Variables

You can define custom variables within your rules:

```
---
description: "React component standards"
globs: ["src/components/**/*.tsx"]
variables:
  componentPrefix: "App"
  styleImport: "import styles from './${fileName}.module.css';"
---

# React Component Standards

All component names should start with ${componentPrefix}.

<example>
${styleImport}

export const ${componentPrefix}Button = () => {
  // Component implementation
};
</example>
```

### When to Use Variables

Use variables when:

1. **Maintaining consistency**: For values that should be consistent across rules
2. **Adapting to context**: When the rule should adapt based on file or project context
3. **Avoiding repetition**: For frequently used values or patterns
4. **Improving maintainability**: To make it easier to update values in one place

### Practical Examples

#### Component Naming Convention

```
## Naming Convention

Components should follow the naming pattern `${componentPrefix}${ComponentName}`.

<example>
// Good
export const ${componentPrefix}UserProfile = () => { ... };

// Bad
export const UserProfile = () => { ... };
</example>
```

#### Import Patterns

```
## Import Structure

Imports should follow this structure:

<example>
// React and third-party libraries
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

// Project utilities and hooks
import { useAuth } from '${projectRoot}/hooks/useAuth';
import { formatDate } from '${projectRoot}/utils/formatters';

// Components
import { Button } from '${projectRoot}/components/ui';

// Styles
import styles from './${fileName}.module.css';
</example>
```

## File References in Cursor Rules

File references allow you to include content from other files as context for your rules, helping the AI understand the broader project structure.

### Reference Syntax

File references use the `@file` syntax:

```
@file ../tsconfig.json
@file ../package.json
```

### Types of References

#### Direct File References

Reference specific files to provide context:

```
# TypeScript Configuration

The project has the following TypeScript configuration:

@file ../tsconfig.json
```

#### Rule References

Reference other rule files:

```
@rule typescript-standards.mdc
```

#### Project Information Reference

Reference a central project information file:

```
@projectinfo.mdc
```

### When to Use File References

Use file references when:

1. **Providing configuration context**: Include relevant configuration files
2. **Showing dependencies**: Reference package.json to show dependencies
3. **Demonstrating patterns**: Reference existing files as examples
4. **Extending other rules**: Reference common rule patterns

### Practical Examples

#### Configuration Reference

```
# React Component Standards

These standards are based on our project configuration:

@file ../tsconfig.json
@file ../eslintrc.js

## TypeScript Requirements

All components should use TypeScript with strict type checking enabled.
```

#### Existing Implementation Reference

```
# API Service Pattern

Follow this pattern for creating API services:

@file ../src/services/userService.ts

## Implementation Requirements

All services should implement error handling and authentication as shown in the example above.
```

## Combining Advanced Features

The true power of Cursor rules comes from combining these advanced features:

```
---
description: "Standards for React components"
globs: ["src/components/**/*.tsx"]
tags: ["react", "components"]
priority: 4
---

# React Component Standards

These standards apply to all React components in the ${projectName} project.

@file ../tsconfig.json
@file ../src/components/Button.tsx

## Component Structure

<example language="tsx">
import React from 'react';
import styles from './${fileName}.module.css';

interface ${componentPrefix}${componentName}Props {
  // Props definition
}

export const ${componentPrefix}${componentName}: React.FC<${componentPrefix}${componentName}Props> = (props) => {
  // Implementation
};
</example>

<note type="warning">
Always define prop types using TypeScript interfaces.
</note>
```

By mastering these advanced features, you can create sophisticated Cursor rules that provide rich context and guidance to the AI, resulting in more accurate and consistent code generation. 