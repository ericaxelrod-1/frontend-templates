# Technology Stack

## Backend (NestJS)
- **Framework**: NestJS 11.x with TypeScript
- **Database**: SQLite (development) / PostgreSQL (production)
- **ORM**: TypeORM 0.3.x with decorators and migrations
- **Authentication**: JWT with Passport (passport-jwt, passport-local)
- **Security**: bcrypt for password hashing, rate limiting, CAPTCHA
- **Caching**: Node-cache and cache-manager for performance
- **Validation**: class-validator and class-transformer
- **Documentation**: Swagger/OpenAPI integration

## Frontend (Angular)
- **Framework**: Angular 18.x with TypeScript
- **UI Library**: Angular Material 18.x
- **State Management**: NGXS with router and form plugins
- **Styling**: SCSS with Material Design theming
- **Notifications**: ngx-toastr
- **Build**: Angular CLI with SSR support

## Development Tools
- **Package Manager**: npm
- **Testing**: Jest (backend), Karma/Jasmine (frontend)
- **Linting**: ESLint with TypeScript support
- **Code Formatting**: Prettier
- **Database Tools**: Custom Python scripts for schema validation

## Common Commands

### Backend Development
```bash
cd angular/backend

# Development
npm run start:dev          # Start with hot reload
npm run build             # Build for production
npm run test              # Run unit tests

# Database Management
npm run migration:run     # Run pending migrations
npm run migration:generate # Generate new migration
npm run db:prepare        # Prepare SQLite database
npm run db:seed          # Seed initial data

# Permission System
npm run permissions:scan  # Scan and register components/routes/endpoints
npm run sync:permissions-cache # Sync permission cache
```

### Frontend Development
```bash
cd angular/frontend

# Development
npm start                 # Start dev server (port 4200)
npm run build            # Build for production
npm run test             # Run unit tests
npm run lint             # Lint TypeScript and SCSS

# Style Validation
npm run verify:styles    # Validate SCSS and Material theme
npm run verify:layouts   # Check layout nesting
npm run verify          # Full verification including build
```

### Full Stack Development
```bash
# Start both backend and frontend
cd angular/backend && npm run start:dev &
cd angular/frontend && npm start
```

## Database Configuration
- Uses TypeORM with entity-first approach
- SQLite for development (db.sqlite)
- Migrations managed manually with custom scripts
- Snake_case database columns, camelCase entity properties
- Automatic naming strategy translation

## Key Architecture Patterns
- Modular NestJS architecture with feature modules
- Shared modules pattern for breaking circular dependencies
- Dynamic permission registration with decorators
- Component scanning and automatic discovery
- Cache-first permission checking for performance