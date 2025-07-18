# Project Structure

## Root Directory Layout
```
├── angular/                    # Main application directory
│   ├── backend/               # NestJS API server
│   ├── frontend/              # Angular client application
│   ├── docs/                  # Project documentation
│   └── utilities/             # Shared utilities and scripts
├── docs/                      # Additional documentation
├── .delete/                   # Archived/deprecated files
└── .kiro/                     # Kiro IDE configuration
```

## Backend Structure (angular/backend/)
```
src/
├── modules/                   # Feature modules
│   ├── auth/                 # Authentication & security
│   ├── users/                # User management
│   ├── roles/                # Role management
│   ├── permissions/          # Permission system core
│   └── groups/               # Group management
├── database/                 # Database configuration
│   ├── migrations/           # TypeORM migrations
│   ├── data-source.ts        # Database connection config
│   └── seed.ts              # Database seeding
├── scripts/                  # Utility scripts
├── shared/                   # Shared modules and utilities
└── main.ts                   # Application entry point
```

## Frontend Structure (angular/frontend/)
```
src/
├── app/
│   ├── core/                 # Core services and guards
│   ├── shared/               # Shared components and directives
│   ├── features/             # Feature modules
│   │   ├── auth/            # Authentication pages
│   │   ├── users/           # User management
│   │   ├── roles/           # Role management
│   │   └── groups/          # Group management
│   ├── layouts/             # Application layouts
│   └── app.component.ts     # Root component
├── assets/                   # Static assets
├── styles/                   # Global SCSS styles
└── environments/            # Environment configurations
```

## Key Architectural Patterns

### Module Organization
- **Feature Modules**: Each domain (users, roles, permissions) has its own module
- **Shared Modules**: Common functionality extracted to prevent circular dependencies
- **Core Module**: Singleton services and app-wide providers

### Entity Structure
- Entities use camelCase properties that map to snake_case database columns
- All entities include `@CreateDateColumn` and `@UpdateDateColumn` decorators
- Foreign key relationships use `@JoinColumn` decorators
- Backward compatibility maintained with getter/setter methods

### Permission System Architecture
- **Dynamic Registration**: Components, routes, and endpoints auto-register with decorators
- **Hierarchical Structure**: Permissions inherit through roles and groups
- **Cache Layer**: SQLite cache database for performance optimization
- **Scanner Services**: Automatic discovery of UI components and API endpoints

### Database Conventions
- Table names use snake_case (e.g., `user_permissions`, `role_permissions`)
- Primary keys are typically `id` with auto-increment
- Foreign keys follow pattern `{table}_id` (e.g., `user_id`, `role_id`)
- Join tables use composite naming (e.g., `user_group`, `role_permission`)

### File Naming Conventions
- Entities: `*.entity.ts`
- Controllers: `*.controller.ts`
- Services: `*.service.ts`
- DTOs: `*.dto.ts`
- Modules: `*.module.ts`
- Migrations: `{timestamp}-{description}.ts`

## Important Directories

### Documentation
- `angular/docs/`: Comprehensive system documentation
- `docs/`: Additional project documentation and guides

### Configuration
- `.kiro/`: Kiro IDE settings and steering rules
- `angular/backend/src/database/`: Database configuration and migrations
- `angular/frontend/src/environments/`: Environment-specific settings

### Utilities
- `angular/utilities/`: Shared scripts and tools
- `angular/backend/src/scripts/`: Database and permission management scripts
- Root-level Python scripts: Schema validation and database tools

## Critical Compliance Notes
- **No Task-Related Objects**: This project strictly prohibits any task management functionality
- **Entity Alignment**: Ongoing work to align TypeORM entities with database schema
- **Migration Management**: Custom scripts handle SQLite-specific migration requirements
- **Permission Caching**: Performance-critical permission checks use dedicated cache layer