# Introduction to Cursor Rules

## What Are Cursor Rules?

Cursor rules are configuration files that customize how the AI in Cursor IDE behaves when analyzing and generating code for your projects. Written in a special format called MDC (Markdown Configuration), these rules provide context, guidelines, and preferences to the AI, making it more aware of your project's specific requirements and coding standards.

Cursor rules have replaced the older `.cursorrules` format with a more structured approach using `.mdc` files located in the `.cursor/rules/` directory of your project.

## Why Use Cursor Rules?

Cursor rules offer several compelling benefits for developers:

1. **Consistent Code Generation**: Ensure all AI-generated code follows your team's coding standards and practices.

2. **Project-Specific Context**: Give the AI deeper understanding of your project structure, architecture, and special requirements.

3. **Reduced Prompting**: Eliminate the need to repeatedly instruct the AI about your project's requirements.

4. **Improved Accuracy**: When properly configured, rules help the AI generate more accurate and relevant code suggestions.

5. **Knowledge Sharing**: Rules can serve as documentation for team members about project standards and patterns.

6. **Workflow Optimization**: Define custom behaviors for different file types and project areas.

7. **Fine-Grained Control**: Apply different rules to different parts of your codebase based on file types or locations.

## How Cursor Rules Work

When you interact with Cursor's AI, the system looks for relevant rules based on:

1. **The files you're working with**: Rules with matching glob patterns are automatically applied.
2. **The type of operation**: Rules may be triggered by specific actions like file changes or user requests.
3. **Explicit references**: You can reference specific rules in your prompts to the AI.

The AI then interprets these rules to adjust its behavior, prioritizing them based on specificity, priority settings, and recency.

## Global vs. Project Rules

Cursor supports two types of rules:

- **Global Rules**: Set in Cursor Settings under "General" > "Rules for AI". These apply across all your projects and are ideal for your personal coding preferences.

- **Project Rules**: Stored as `.mdc` files in the `.cursor/rules/` directory of your project. These are specific to each project and are automatically tracked in version control when committed.

## Getting Started with Cursor Rules

To start using Cursor rules:

1. Create a `.cursor/rules/` directory in your project (if it doesn't already exist).
2. Add `.mdc` files to define your rules, using the format described in the next section.
3. Make sure your rules are accurately targeted using glob patterns.

For a complete understanding of how to format and organize your rules, continue to the [Cursor Rules Format Guide](./format-guide.md). 