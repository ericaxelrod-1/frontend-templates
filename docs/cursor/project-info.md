# Project Information Files in Cursor Rules

This guide explains how to use central project information files to provide consistent context across all your Cursor rules.

## What is a Project Information File?

A project information file is a special `.mdc` file that serves as a centralized source of information about your project. It contains details about the project's architecture, structure, key patterns, and conventions that can be referenced by other rule files.

This approach has several benefits:
- Maintains consistency across rules
- Reduces duplication of information
- Makes it easier to update project-wide information
- Provides a centralized overview of the project

## Creating a Project Information File

### Basic Structure

Typically, a project information file is named `000-project-info.mdc` or `projectinfo.mdc` and placed in the `.cursor/rules/` directory:

```
---
description: "Central project information for all Cursor rules"
globs: [".cursor/rules/*.mdc"]
tags: ["project", "meta"]
priority: 5
---

# Project Overview

## Project Name: MyAwesomeProject

## Architecture

MyAwesomeProject follows a layered architecture pattern with:

- Presentation Layer (React components)
- Application Layer (Services and state management)
- Domain Layer (Business logic and models)
- Infrastructure Layer (API clients, storage, etc.)

## Technology Stack

- Frontend: React 18 with TypeScript
- State Management: Redux Toolkit
- Styling: Styled Components
- API: RESTful API with Axios
- Testing: Jest and React Testing Library

## Key Conventions

### File Structure

- Components follow the Atomic Design pattern
- Each component has its own directory with index.ts
- Tests are placed in __tests__ directories
```

### Key Sections to Include

A comprehensive project information file might include the following sections:

1. **Project Overview**: Brief description of the project's purpose and goals
2. **Architecture**: High-level architecture patterns and layers
3. **Technology Stack**: Key technologies, libraries, and frameworks
4. **Conventions**: Coding, naming, and file organization conventions
5. **Workflow**: Development, testing, and deployment processes
6. **Contact Information**: Team members and responsibilities

## Referencing the Project Information File

### From Other Rules

Other rule files can reference your project information file using the `@projectinfo.mdc` syntax:

```
---
description: "React component standards"
globs: ["src/components/**/*.tsx"]
---

# React Component Standards

@projectinfo.mdc

## Component Structure

Based on our project architecture, components should follow these standards:
...
```

### Using Variables from Project Info

You can define variables in your project information file that can be used in other rules:

```
---
description: "Central project information"
globs: [".cursor/rules/*.mdc"]
variables:
  projectPrefix: "APP"
  apiBase: "/api/v1"
  componentNamingPattern: "${projectPrefix}${ComponentName}"
---

# Project Information
...
```

Then reference these variables in other rules:

```
---
description: "Component naming conventions"
globs: ["src/components/**/*.tsx"]
---

# Component Naming

All components should follow the ${componentNamingPattern} convention.
```

## Real-World Example

Here's a comprehensive example of a project information file for a React application:

```
---
description: "Essential project information and architecture for the E-commerce Dashboard"
globs: [".cursor/rules/*.mdc"]
tags: ["project", "architecture", "conventions"]
priority: 5
variables:
  projectName: "E-commerce Dashboard"
  apiBase: "/api/v1"
  componentPrefix: "Eco"
  primaryColor: "#3A7BDB"
  secondaryColor: "#F8CF40"
---

# E-commerce Dashboard Project

## Project Overview

${projectName} is an admin dashboard for managing an e-commerce platform, including product management, order processing, customer management, and analytics.

## Architecture

The application follows a layered architecture:

1. **UI Layer**
   - React components (Atomic Design)
   - Theme and styling (Material UI + custom theme)

2. **State Management Layer**
   - Redux for global state
   - React Query for server state
   - Context API for UI state

3. **Service Layer**
   - API services (REST)
   - Authentication service
   - Analytics service

4. **Infrastructure Layer**
   - Network client (Axios)
   - Storage (localStorage, IndexedDB)
   - Logger

## Technology Stack

### Frontend
- React 18.2.0
- TypeScript 4.9.5
- Redux Toolkit 1.9.3
- Material UI 5.11.12
- React Query 4.8.0
- Axios 1.3.4
- Chart.js 4.2.1
- Formik 2.2.9
- Yup 1.0.2

### Backend (for reference)
- Node.js
- Express
- MongoDB
- Redis for caching

## Key Conventions

### File Structure

```
src/
├── assets/           # Static resources
├── components/       # Shared UI components
│   ├── atoms/        # Smallest UI elements
│   ├── molecules/    # Groups of atoms
│   ├── organisms/    # Groups of molecules
│   └── templates/    # Page layouts
├── features/         # Feature-specific modules
│   ├── products/     # Product management feature
│   ├── orders/       # Order management feature
│   └── customers/    # Customer management feature
├── hooks/            # Custom React hooks
├── services/         # API and other services
├── store/            # Redux store configuration
├── theme/            # Styling and theming
├── utils/            # Utility functions
└── App.tsx           # Root component
```

### Naming Conventions

- Components: PascalCase with ${componentPrefix} prefix
- Files: kebab-case for utilities, PascalCase for components
- Functions: camelCase
- Constants: UPPER_SNAKE_CASE
- CSS classes: kebab-case

### Coding Standards

- Functional components with hooks
- Typescript interfaces for all props
- Redux slices for state management
- Material UI for base components
- Custom theme extending Material UI
- Jest and React Testing Library for tests

## Contact Information

- Team Lead: Jane Smith (jane.smith@example.com)
- Frontend Architect: John Doe (john.doe@example.com)
- UX Designer: Alice Johnson (alice.johnson@example.com)
```

## Using Multiple Information Files

For larger projects, you might want to split your project information into multiple files:

### Core Project Info

```
---
description: "Core project information"
globs: [".cursor/rules/*.mdc"]
---

# Project Core Information

## Project Name: Enterprise Portal

## Overview
...
```

### Architecture Info

```
---
description: "Architecture information"
globs: [".cursor/rules/*.mdc"]
---

# Architecture Information

@projectinfo.mdc

## Architecture Patterns
...
```

### Stack Info

```
---
description: "Technology stack information"
globs: [".cursor/rules/*.mdc"]
---

# Technology Stack

@projectinfo.mdc

## Frontend Stack
...
```

## Best Practices for Project Information Files

1. **Keep it focused**: Include only essential information that's relevant across multiple rules.

2. **Update regularly**: Treat the project information file as living documentation that evolves with your project.

3. **Use clear structure**: Organize information with clear headings and lists for easy reference.

4. **Prioritize it**: Give project information files a high priority (4-5) to ensure they take precedence.

5. **Version it**: Include a version number and last updated date to track changes.

6. **Reference it widely**: Make sure all relevant rule files reference the project information file.

7. **Include diagrams**: Use ASCII diagrams or references to visual documentation where helpful.

8. **Define common variables**: Use the variables section for values that are used across multiple rules.

By using a well-maintained project information file, you can ensure that all Cursor rules have access to consistent, accurate information about your project's architecture, patterns, and conventions. 