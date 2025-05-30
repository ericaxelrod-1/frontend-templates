# Project Structure Documentation

This document outlines the structure of the Angular project, explaining the purpose and content of each directory.

## Root Structure

```
angular/
├── frontend/         # Angular frontend application
├── backend/          # NestJS backend application
├── docs/             # Project documentation
├── scripts/          # Project-wide utility scripts
├── migration/        # Database and permission migration scripts
```

## Frontend Structure (`angular/frontend/`)

### Purpose
Contains the Angular application that handles the client-side presentation, routing, and user interactions.

### Main Directories

```
frontend/
├── src/              # Source code for the Angular application
│   ├── app/          # Angular components, services, and modules
│   │   ├── components/    # Shared components
│   │   ├── core/          # Core services, guards, and interceptors
│   │   ├── features/      # Feature modules and components
│   │   ├── layouts/       # Layout components (headers, footers)
│   │   ├── models/        # TypeScript interfaces and type definitions
│   │   ├── modules/       # Angular modules
│   │   ├── pages/         # Page components
│   │   ├── services/      # Application services
│   │   ├── shared/        # Shared utilities, pipes, directives
│   │   └── store/         # State management
│   ├── assets/       # Static assets (images, fonts)
│   ├── environments/ # Environment configuration
│   └── styles/       # Global styles and themes
├── dist/             # Compiled output (generated)
├── node_modules/     # NPM dependencies (generated)
├── docs/             # Frontend-specific documentation
├── tools/            # Frontend build tools and utilities
└── .angular/         # Angular CLI cache (generated)
```

### File Types
- **TypeScript (.ts)**: Angular components, services, modules
- **HTML (.html)**: Angular templates
- **SCSS (.scss)**: Styling
- **Spec (.spec.ts)**: Unit tests
- **JSON (.json)**: Configuration files
- **JavaScript (.js)**: Build and configuration scripts

## Backend Structure (`angular/backend/`)

### Purpose
Provides the server-side API, authentication, database access, and business logic using NestJS.

### Main Directories

```
backend/
├── src/                  # Source code for the NestJS application
│   ├── modules/          # Feature modules
│   │   ├── auth/         # Authentication and authorization
│   │   ├── users/        # User management
│   │   ├── permissions/  # Permission management
│   │   └── [other modules]/
│   ├── common/           # Common utilities and helpers
│   ├── config/           # Configuration 
│   ├── database/         # Database configuration
│   ├── logger/           # Logging services
│   └── shared/           # Shared services and utilities
├── dist/                 # Compiled output (generated)
├── node_modules/         # NPM dependencies (generated)
├── scripts/              # Backend utility scripts
├── test/                 # Integration tests
├── db/                   # Database scripts and schemas
└── logs/                 # Server logs (generated)
```

### File Types
- **TypeScript (.ts)**: NestJS controllers, services, modules
- **Entity (.entity.ts)**: Database entity definitions
- **DTOs (.dto.ts)**: Data transfer objects
- **Module (.module.ts)**: NestJS modules
- **Spec (.spec.ts)**: Unit and integration tests
- **JSON (.json)**: Configuration files
- **JavaScript (.js)**: Utility scripts

### Backend Source Code (`/backend/src`)

#### DTOs (`/modules/*/dtos`)
Contains Data Transfer Objects used for API requests and responses:
- `api-endpoint.dto.ts` - DTO for API endpoint information

## Documentation Structure (`angular/docs/`)

### Purpose
Contains all project documentation, including implementation guides, API docs, and development notes.

### Main Files
- **IMPLEMENTATION_STEPS.md**: Task-based implementation guide
- **CURRENT_STATE.md**: Current project status
- **API_DOCUMENTATION.md**: API documentation
- **DEVELOPMENT_GUIDE.md**: Developer onboarding guide
- **DEBUGGING_LOGGING.md**: Debug and logging information
- **SECURITY.md**: Security considerations
- **DATABASE_SCHEMA.md**: Database schema documentation

### Task Management (`angular/docs/task-management/`)
- **backlog.md**: Tracking of pending issues, bugs, and feature requests
- **changelog.md**: Tracking of in-progress and recently completed work (last 7 days)
- **changelog_archive.md**: Historical record of all completed work

## Scripts Directory (`angular/scripts/`)

### Purpose
Contains project-wide utility scripts for setup, deployment, and maintenance.

### File Types
- **PowerShell (.ps1)**: Windows automation scripts
- **Shell scripts (.sh)**: Linux/Mac automation scripts
- **JavaScript/TypeScript (.js/.ts)**: Node.js utility scripts

## Migration Directory (`angular/migration/`)

### Purpose
Contains database migration scripts and permission system migration utilities.

### Main Components
- Database schema migrations
- Data migration scripts
- Permission structure migrations
- Migration logs and reports

## Configuration Files

### Frontend Configuration
- **angular.json**: Angular CLI configuration
- **tsconfig.json**: TypeScript compiler configuration
- **package.json**: NPM dependencies and scripts
- **eslint.config.js**: ESLint configuration
- **.stylelintrc.json**: Style linting rules

### Backend Configuration
- **tsconfig.json**: TypeScript compiler configuration
- **package.json**: NPM dependencies and scripts
- **nest-cli.json**: NestJS CLI configuration
- **.env**, **.env.development**, **.env.test**: Environment configurations
- **eslint.config.mjs**: ESLint configuration 