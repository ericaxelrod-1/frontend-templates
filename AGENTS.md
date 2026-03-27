# AGENTS.md - Agent Coding Guidelines

This file provides guidelines for agents operating in this repository.

## Agent Workflow Rules

**IMPORTANT: Orchestrator must not invoke itself**
- The orchestrator agent IS the primary agent in this session
- When given a task, invoke `@developer` and `@code-review` subagents directly
- Do NOT invoke `@orchestrator` as a subagent - that creates a recursive loop

**Correct workflow:**
1. Receive task as orchestrator
2. Invoke `@developer` subagent to implement the fix
3. Invoke `@code-review` subagent to verify and approve
4. Code-review agent commits and pushes approved changes

---

## Project Overview

- **Frontend**: Angular 18.2.13 with Angular Material
- **State Management**: NGXS
- **Location**: `angular/frontend/`
- **Backend**: Node.js/Express + NestJS in `angular/backend/`

---

## Running the Servers (Production - Primary Method)

**Use production mode by default** for memory savings. Only use dev/test mode when specifically needed.

### Backend (NestJS)

```bash
cd angular/backend

# First-time setup (only once)
npm install
npm run migration:run

# Production run (after build)
npm run start:prod
```

The backend runs at `http://localhost:3000`.

### Frontend (Angular SSR)

```bash
cd angular/frontend

# First-time setup (only once)
npm install

# Production run
npm run serve:ssr:frontend
```

The frontend runs at `http://localhost:4000` (SSR server).

---

## Development Mode (Only when needed)

### Backend Dev

```bash
cd angular/backend
npm run start:dev        # Development with hot reload
```

### Frontend Dev

```bash
cd angular/frontend
npm run start            # Dev server at localhost:4200
```

---

## Build, Lint, and Test Commands

### Angular Frontend (`angular/frontend/`)

```bash
# Development server
npm run start                    # Start dev server at localhost:4200

# Build
npm run build                    # Production build
npm run watch                    # Watch mode for development

# Testing
npm run test                     # Run all tests (Karma/Jasmine)
npm run test -- --include="**/specific-test.spec.ts"   # Single test file
npm run test -- --watch=false    # Run tests once (CI mode)

# Linting
npm run lint                     # ESLint for TypeScript
npm run lint:styles              # Stylelint for SCSS
npm run verify                   # Full verification (styles + build)

# Security
npm run security:audit           # Run security audit
```

### Quick Reference

| Task | Command |
|------|---------|
| Start dev server | `npm run start` |
| Run single test | `npm run test -- --include="path/to/test.spec.ts"` |
| Lint TS | `npm run lint` |
| Lint CSS | `npm run lint:styles` |
| Full build | `npm run build` |

---

## Code Style Guidelines

### TypeScript

**Type Safety (from `.cursor/rules/200-typescript.mdc`)**
- Prefer explicit types over inferred types for function parameters/return values
- Avoid `any` - use `unknown` when type is indeterminate
- Use interfaces for object shapes, type aliases for unions
- Enable strict mode in tsconfig.json

**Naming Conventions**
- Interfaces/Types/Classes: `PascalCase` (e.g., `UserService`, `DiagramTableNode`)
- Variables/Properties/Functions: `camelCase` (e.g., `selectedNodeId`, `onEdgeSelected`)
- Files: `kebab-case` (e.g., `join-path-diagram.component.ts`)

**Imports Order**
1. Angular core modules (`@angular/core`, `@angular/common`)
2. Third-party libraries (`@angular/material`, `ng-diagram`, `ngxs`)
3. Application imports (services, components, models)
4. Relative paths last

**Error Handling**
```typescript
// ✅ Correct
catch (error: unknown) {
  const typedError = error as HttpErrorResponse;
  // Handle typed error
}

// ❌ Avoid
catch (error: any) { }
```

**Prohibited Patterns**
- `!` non-null assertion operator
- `as any` type assertions
- Constant conditions (`if (true)`)
- Using `Object` or `{}` as types (use `Record<string, unknown>`)

---

### Angular Components

**Template Priority** (from `.cursor/rules/101-angular-design-patterns.mdc`)
- Components can have EITHER `template` (inline) OR `templateUrl` (external), NEVER both
- Check component decorator to know which is used

**Event Flow**
- Child: `@Output() eventName = new EventEmitter<void>();`
- Parent template: `(eventName)="handler()"`
- Always verify complete event flow

**Material Chips** (from `.cursor/rules/101-angular-design-patterns.mdc`)
- Angular Material 18+ uses MDC architecture - custom chip styling is unreliable
- Use separate indicator elements (divs) instead of styled chips
```scss
// ✅ Recommended
.severity-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

// ❌ Avoid - unreliable
.mat-mdc-chip { background-color: red !important; }
```

---

### SCSS/CSS

**Fluid Design** (from `.cursor/rules/101-angular-design-patterns.mdc`)
- Use `clamp()` for fluid typography/spacing
- Remove fixed `max-width` constraints from layouts
- Use `auto-fit` grid patterns

```scss
// ✅ Correct
.container {
  width: 100%;
  padding: clamp(8px, 2vw, 24px);
}

// ❌ Avoid
.container { max-width: 1200px; }
```

**CSS Syntax**
- Validate syntax - missing brackets break entire stylesheets
- Check browser console for CSS parsing errors

---

## Project Structure

See [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) for full directory layout.

**Key Directories**
- `src/app/features/` - Feature modules
- `src/app/components/` - Shared components
- `src/app/core/` - Services, guards, interceptors
- `src/app/layouts/` - Layout components
- `src/app/services/` - Application services
- `src/app/models/` - Interfaces and types

---

## Cursor Rules

This project includes Cursor rules in `.cursor/rules/`. Key rules to follow:

1. **000-variables.mdc** - Project path definitions
2. **020-project-structure.mdc** - File placement guidelines
3. **101-angular-design-patterns.mdc** - Angular patterns, Material best practices
4. **200-typescript.mdc** - TypeScript strict requirements

---

## Common Pitfalls

1. **Template Conflicts**: Check if component uses `template` vs `templateUrl`
2. **Event Flow**: Always trace events from emission to handling
3. **CDK Overlay**: Avoid mat-menu for complex menus, use mat-sidenav
4. **Responsive**: Check CSS syntax before debugging responsive issues
5. **Chip Styling**: Use separate elements, not custom mat-chip colors

---

## Before Submitting Changes

- [ ] Run `npm run lint` - fix any ESLint issues
- [ ] Run `npm run lint:styles` - fix any Stylelint issues
- [ ] Run `npm run test` - ensure all tests pass
- [ ] Verify build succeeds (`npm run build`)
- [ ] Test on multiple screen sizes if responsive changes
- [ ] Check browser console for errors