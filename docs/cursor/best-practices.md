# Best Practices for Cursor Rules

This guide provides recommendations for organizing, structuring, and maintaining Cursor rules effectively.

## Rule File Organization

### Directory Structure

A well-organized rules directory makes it easier to find, update, and maintain your rules:

```
.cursor/
  rules/
    000-project-info.mdc         # Project overview
    100-typescript.mdc           # Language-specific rules
    200-react.mdc                # Framework-specific rules
    300-testing.mdc              # Testing guidelines
    400-api.mdc                  # API guidelines
    components/                  # Component-specific rules
      button.mdc
      forms.mdc
    patterns/                    # Common patterns
      error-handling.mdc
      state-management.mdc
```

### Naming Conventions

Use a consistent naming scheme for your rule files:

#### Prefix-Based Naming

```
PREFIX-name.mdc
```

Where PREFIX indicates the rule category:

- `000-099`: Core project information and standards
- `100-199`: Language-specific rules (TypeScript, JavaScript, etc.)
- `200-299`: Framework-specific rules (React, Angular, Vue, etc.)
- `300-399`: Testing standards and patterns
- `400-499`: API and data handling guidelines
- `500-599`: Build and deployment guidelines
- `800-899`: Workflow rules
- `900-999`: Templates

#### Descriptive Names

Alternative to prefixes, use fully descriptive names that clearly indicate the rule's purpose:

```
typescript-standards.mdc
react-component-structure.mdc
api-service-pattern.mdc
error-handling-guidelines.mdc
```

## Rule Size and Scope

### Rule Granularity

**Small, focused rules** are generally better than large, comprehensive ones:

- **Good**: One rule per concern (e.g., separate rules for React component structure, props, and state management)
- **Avoid**: Monolithic rules that try to cover multiple concerns

### Practical Limits

While there are no hard technical limits on rule file size, consider these guidelines:

1. **File Size**: Keep individual rule files under 500 lines
   - Larger files become difficult to maintain
   - The AI may not fully process very large files

2. **Number of Rules**: There's no strict limit, but consider practicality
   - **10-20 rules** is reasonable for most projects
   - **5-10 active rules** might apply to any given file
   - Too many rules can slow down AI processing and potentially cause conflicts

3. **Glob Specificity**: More specific globs lead to better performance
   - Prefer `src/components/**/*.tsx` over `**/*.tsx`
   - This helps the AI quickly identify which rules to apply

## Content Organization

### Focus on Clarity and Specificity

Each rule should:

1. **Start with clear context** about when and why it applies
2. **List specific requirements** that are actionable and verifiable
3. **Provide concrete examples** of both good and bad practices
4. **Be scannable** with proper headings and lists

### Avoid Rule Bloat

Not everything needs to be in a rule. Focus on:

1. **Project-specific standards** that differ from common practices
2. **Recurring patterns** that are used throughout the codebase
3. **Known pain points** where guidance is frequently needed
4. **Complex requirements** that need clear explanation

### Keep Rules Updated

Rules should evolve with your project:

1. **Regular reviews**: Schedule periodic reviews of rules for relevance
2. **Deprecation process**: Rather than deleting obsolete rules, mark them as deprecated
3. **Version tracking**: Use the version field to track significant changes

## Rule Conflicts and Resolution

### Handling Conflicts

When rules conflict, Cursor uses these resolution strategies:

1. **Priority**: Higher priority rules (1-5) override lower ones
2. **Specificity**: More specific globs take precedence over general ones
3. **Recency**: Later rules in the processing order can override earlier ones

### Avoiding Conflicts

To minimize conflicts:

1. **Use specific globs** to target rules precisely
2. **Assign appropriate priorities** to critical rules
3. **Split overlapping rules** into more focused ones
4. **Use consistent terminology** across rules

## Testing and Validating Rules

### Testing Approaches

Validate your rules to ensure they work as intended:

1. **Cursor testing**: Apply rules to representative files and check AI responses
2. **Peer review**: Have team members review and provide feedback on rules
3. **Incremental deployment**: Roll out new rules gradually to monitor impact

### Common Issues

Watch for these issues when implementing rules:

1. **Over-specificity**: Rules that are too specific may not apply when needed
2. **Over-generality**: Rules that are too general may apply when not appropriate
3. **Conflicting requirements**: Contradictory guidance across rules
4. **Outdated references**: References to files or patterns that have changed

## Rules as Documentation

Cursor rules serve dual purposes:

1. **Guiding the AI** in generating and modifying code
2. **Documenting standards** for human developers

To maximize documentation value:

1. **Include rationales**: Explain why standards exist, not just what they are
2. **Link to resources**: Reference external documentation when appropriate
3. **Update regularly**: Keep rules in sync with evolving project standards
4. **Use clear language**: Write for humans first, AI second

## Team Collaboration

### Onboarding

Rules can accelerate team onboarding:

1. **Include a welcome rule** that explains the project structure
2. **Document key patterns** that new team members need to understand
3. **Create contextual rules** for complex areas of the codebase

### Rule Contribution Process

Establish a process for contributing rules:

1. **Rule proposals**: Process for suggesting new rules
2. **Review criteria**: Standards for evaluating rule quality
3. **Change management**: How rule updates are communicated to the team

## Performance Considerations

To ensure rules perform well:

1. **Use efficient glob patterns** to reduce unnecessary rule processing
2. **Limit file references** to those that provide essential context
3. **Focus on high-impact areas** where AI guidance is most valuable
4. **Regularly clean up unused rules** to reduce processing overhead

## Integration with Other Tools

Cursor rules can complement other tools in your development workflow:

1. **ESLint/Prettier**: Rules can reference or extend your linting configuration
2. **TypeScript**: Rules can reinforce your TypeScript configuration
3. **Testing frameworks**: Rules can guide testing patterns and practices
4. **CI/CD**: Rules can document deployment and build requirements

By following these best practices, you can create a cohesive set of Cursor rules that enhances both AI assistance and human understanding of your project standards. 