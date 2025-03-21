# Cursor Rules Format Guide

This guide explains the format of `.mdc` (Markdown Configuration) files used for Cursor rules, including the header fields, Markdown structure, and special syntax.

## Basic File Structure

A Cursor rule file (`.mdc`) consists of two main parts:

1. **YAML Front Matter**: Metadata enclosed in triple dashes (`---`)
2. **Markdown Content**: The actual rule content written in Markdown

Here's a basic template:

```
---
description: "Brief description of what this rule does"
globs: ["src/**/*.ts", "src/**/*.tsx"]
tags: ["typescript", "react"]
priority: 3
---

# Rule Title

## Context
Information about when this rule applies

## Requirements
- Specific guidelines
- Standards to follow

## Examples
Examples of good and bad practices
```

## YAML Front Matter Fields

The front matter contains metadata that helps Cursor understand how to apply the rule. Here are the available fields:

### Required Fields

| Field | Description | Example |
|-------|-------------|---------|
| `description` | A concise description of what the rule does. This helps the AI determine when to apply the rule. | `"TypeScript coding standards for React components"` |
| `globs` | File patterns this rule applies to, using [glob syntax](https://en.wikipedia.org/wiki/Glob_(programming)). Can be a string or array. | `["src/**/*.ts", "src/**/*.tsx"]` |

### Optional Fields

| Field | Description | Example |
|-------|-------------|---------|
| `name` | A unique identifier for the rule (rarely used as the filename serves this purpose). | `"typescript-standards"` |
| `triggers` | Specific events that should trigger this rule. | `["file_change", "user_request"]` |
| `tags` | Categories for organizing and classifying rules. | `["react", "typescript", "components"]` |
| `priority` | A number from 1-5 indicating the rule's priority (higher numbers = higher priority). | `3` |
| `version` | Semantic version of the rule. | `"1.0.0"` |
| `disabled` | Boolean flag to temporarily disable a rule without deleting it. | `false` |

## How to Populate Each Field

### Description

The description should be concise yet informative. The AI uses this to determine whether to apply the rule, so it should clearly state:
- What the rule is for
- When it should be applied
- What problem it solves

**Examples:**
- Good: `"TypeScript standards for React components including prop types and function signatures"`
- Bad: `"Code standards"` (too vague)

### Globs

Globs determine which files the rule applies to. Use standard glob patterns:

- `*` matches any sequence of characters within a filename segment
- `**` matches any number of directories
- `{}` allows for alternatives separated by commas

**Examples:**
- `"src/**/*.ts"` - All TypeScript files in the src directory and subdirectories
- `"src/components/**/*.{tsx,jsx}"` - All TSX and JSX files in the components directory
- `"!node_modules/**"` - Exclude all files in node_modules (using `!`)

### Tags

Tags help organize rules and allow the AI to categorize them more effectively. Use tags to group related rules by:

- Technology: `react`, `angular`, `nextjs`
- Purpose: `components`, `state`, `api`
- Importance: `critical`, `recommended`, `optional`

**What tagging does:**
When you tag a rule with "react", for instance, the AI will more likely apply it when working with React components. Tags improve the AI's understanding of when rules are most applicable.

### Priority

Priority determines which rules take precedence when multiple rules could apply:

- **1**: Low priority, easily overridden
- **3**: Medium priority (default)
- **5**: Highest priority, overrides other rules

For most rules, the default priority (3) is sufficient. Use higher priorities for critical standards that should always be followed.

## Markdown Structure

The Markdown content of your rule should be structured and easy to parse. Here's a recommended structure:

### Headings

```
# Main Title (brief name of the rule)

## Context (when to apply this rule)

## Requirements (what to follow)

## Examples (demonstrations)
```

### Subheadings

Use subheadings (H3, H4) to organize related content:

```
## Requirements

### Code Structure
- Requirement 1
- Requirement 2

### Naming Conventions
- Requirement 3
- Requirement 4
```

### Lists

Use bullet points or numbered lists for clarity:

```
- Use PascalCase for component names
- Use camelCase for variables and functions
- Use UPPER_CASE for constants
```

## Best Practices for MDC Content

1. **Be specific and actionable**: Each requirement should be clear and implementable.
2. **Provide rationale**: Briefly explain why a rule is important.
3. **Include examples**: Show both good and bad examples.
4. **Keep it concise**: Rules should be comprehensive but not verbose.
5. **Use consistent formatting**: Maintain consistent formatting across all rule files.

For advanced features like XML tags and variables, see the [Advanced Features](./advanced-features.md) guide. 