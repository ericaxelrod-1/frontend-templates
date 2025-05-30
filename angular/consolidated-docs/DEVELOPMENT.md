# Development Guide

This guide provides information for developers working on the Angular application with dynamic permissions.

## Table of Contents

1. [Development Environment Setup](#development-environment-setup)
2. [Coding Standards](#coding-standards)
3. [Testing](#testing)
4. [Debugging and Logging](#debugging-and-logging)
5. [Working with Permissions](#working-with-permissions)
6. [Database Management](#database-management)
7. [Deployment](#deployment)
8. [Troubleshooting](#troubleshooting)

## Development Environment Setup

### Prerequisites

- Node.js (v14+)
- npm or yarn
- PostgreSQL database (for production) or SQLite (for development)
- Git

### Setting Up the Development Environment

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd frontend-templates/angular
   ```

2. Install backend dependencies:
   ```bash
   cd backend
   npm install
   ```

3. Install frontend dependencies:
   ```bash
   cd ../frontend
   npm install
   ```

4. Set up environment variables:
   - Create a `.env` file in the backend directory based on `.env.example`
   - Create a `.env` file in the frontend directory based on `.env.example`

5. Run database migrations:
   ```bash
   cd ../backend
   npm run migration:run
   ```

6. Start the development servers:
   ```bash
   # In the backend directory
   npm run start:dev
   
   # In a separate terminal, in the frontend directory
   npm start
   ```

7. Access the application:
   - Frontend: http://localhost:4200
   - Backend API: http://localhost:3000
   - Swagger API documentation: http://localhost:3000/api

## Coding Standards

### TypeScript

- Use TypeScript for all code
- Follow the [Angular Style Guide](https://angular.io/guide/styleguide)
- Use interfaces for data models
- Use proper typing for all variables, parameters, and return values
- Avoid using `any` type when possible

### Angular

- Follow the component-based architecture
- Use smart and presentational components
- Use Angular services for business logic and API communication
- Use Angular directives for DOM manipulation
- Use Angular pipes for data transformation
- Use Angular forms for user input
- Use Angular routing for navigation

### NestJS

- Follow the module-based architecture
- Use controllers for handling HTTP requests
- Use services for business logic
- Use guards for route protection
- Use interceptors for request/response transformation
- Use pipes for data transformation
- Use filters for exception handling

### CSS/SCSS

- Use SCSS for styling
- Follow the BEM (Block Element Modifier) methodology
- Use variables for colors, fonts, and spacing
- Use mixins for reusable styles
- Use nesting for component-specific styles

### Git

- Use feature branches for development
- Use pull requests for code review
- Write descriptive commit messages
- Keep commits focused on a single change
- Rebase feature branches on main before merging

## Testing

### Frontend Testing

#### Unit Tests

Angular components, services, directives, and pipes should have unit tests using Jasmine and Karma.

```bash
# Run all frontend tests
cd frontend
npm run test

# Run tests with coverage
npm run test:coverage

# Run specific tests
npm test -- --include=src/app/shared/directives/has-permission.directive.spec.ts
```

#### End-to-End Tests

End-to-end tests are written using Cypress.

```bash
# Run e2e tests
cd frontend
npm run e2e
```

### Backend Testing

#### Unit Tests

NestJS controllers, services, and providers should have unit tests using Jest.

```bash
# Run all backend tests
cd backend
npm run test

# Run tests with coverage
npm run test:coverage

# Run specific tests
npm test -- users.service
```

#### Integration Tests

Integration tests verify the interaction between different parts of the application.

```bash
# Run integration tests
cd backend
npm run test:e2e
```

### Testing Permissions

Testing permission-related functionality is crucial for ensuring the security of the application.

#### Testing Permission Directives

The application uses structural directives like `*hasPermission` to control UI element visibility based on user permissions. Testing these directives is crucial to ensure:

1. UI elements are correctly shown/hidden based on permissions
2. Permission changes trigger appropriate UI updates
3. Both string and array permission formats work as expected
4. Fallback templates render correctly when permissions are denied

```bash
cd frontend
npm test -- --include=src/app/shared/directives/has-permission.directive.spec.ts
```

#### Testing Permission Guards

Route guards protect routes based on user permissions. Testing these guards ensures:

1. Routes are properly protected based on permissions
2. Users without required permissions are redirected
3. Permission changes are reflected in route access

```bash
cd frontend
npm test -- --include=src/app/core/guards/permission.guard.spec.ts
```

#### Testing API Permission Guards

API endpoints are protected by permission guards. Testing these guards ensures:

1. Endpoints are properly protected based on permissions
2. Requests without required permissions are rejected
3. Permission changes are reflected in API access

```bash
cd backend
npm test -- permission.guard
```

## Debugging and Logging

### Frontend Debugging

#### Browser DevTools

Use browser developer tools for debugging frontend code:
- Chrome DevTools
- Firefox Developer Tools
- Edge DevTools

#### Angular DevTools

Install the [Angular DevTools](https://chrome.google.com/webstore/detail/angular-devtools/ienfalfjdbdpebioblfackkekamfmbnh) browser extension for debugging Angular applications.

#### Console Logging

Use console logging for debugging:
- `console.log()` for general logging
- `console.warn()` for warnings
- `console.error()` for errors
- `console.debug()` for debug information

### Backend Debugging

#### NestJS Debugging

Use the built-in NestJS debugging capabilities:

```bash
# Start the backend in debug mode
cd backend
npm run start:debug
```

Then attach a debugger to the Node.js process.

#### Logging

The backend uses a custom logger for structured logging:

```typescript
// In a NestJS service or controller
import { Logger } from '@nestjs/common';

export class SomeService {
  private readonly logger = new Logger(SomeService.name);

  someMethod() {
    this.logger.log('This is a log message');
    this.logger.warn('This is a warning');
    this.logger.error('This is an error');
    this.logger.debug('This is a debug message');
  }
}
```

#### Debug Mode

Enable debug mode for additional logging:

```bash
# Start the backend in debug mode
cd backend
npm run start:debug
```

### Log Files

Log files are stored in the `logs` directory:
- `error.log`: Error logs
- `combined.log`: All logs
- `debug.log`: Debug logs (only in debug mode)

## Working with Permissions

### Permission System Overview

The permission system is based on the concept of resources and actions:
- **Resource**: An entity or module in the system (e.g., `users`, `reports`, `dashboard`)
- **Action**: An operation on a resource (e.g., `read`, `create`, `update`, `delete`)

A permission combines a resource and an action (e.g., `users:read`).

### Creating New Permissions

New permissions can be created through the admin interface or programmatically:

```typescript
// In a seed service or admin controller
async createNewPermission() {
  // 1. Find or create the resource
  let resource = await this.resourceRepository.findOne({
    where: { name: 'invoices' }
  });
  
  if (!resource) {
    resource = await this.resourceRepository.save({
      name: 'invoices',
      description: 'Invoice management'
    });
  }
  
  // 2. Find or create the action
  let action = await this.actionRepository.findOne({
    where: { name: 'approve' }
  });
  
  if (!action) {
    action = await this.actionRepository.save({
      name: 'approve',
      description: 'Approve an item'
    });
  }
  
  // 3. Create the permission
  await this.permissionRepository.save({
    resourceId: resource.id,
    actionId: action.id,
    description: 'Approve invoices'
  });
}
```

### Assigning Permissions to Roles

Permissions can be assigned to roles through the admin interface or programmatically:

```typescript
// In admin controller
async assignPermissionToRole(roleId: number, permissionId: number) {
  // Check if role permission already exists
  let rolePermission = await this.rolePermissionRepository.findOne({
    where: {
      roleId,
      permissionId
    }
  });
  
  // Create or update it
  if (!rolePermission) {
    rolePermission = this.rolePermissionRepository.create({
      roleId,
      permissionId,
      granted: true // Grant the permission
    });
  } else {
    rolePermission.granted = true; // Ensure it's granted
  }
  
  await this.rolePermissionRepository.save(rolePermission);
}
```

### Registering UI Components with Permissions

UI components can be registered with permissions using decorators:

```typescript
@RegisterPermissionComponent({
  id: 'create_user_btn',
  description: 'Create User Button',
  requiredPermissions: ['users:create']
})
@Component({
  selector: 'app-create-user-button',
  template: '<button>Create User</button>'
})
export class CreateUserButtonComponent {}
```

### Scanning for Permission Components

The permission scanner can be run to discover components with permission requirements:

```bash
# Run the permission scanner
cd backend
npm run permissions:scan
```

## Database Management

### Database Migrations

Database migrations are managed through TypeORM:

```bash
# Generate a new migration
cd backend
npm run migration:generate -- -n MigrationName

# Run migrations
npm run migration:run

# Revert the last migration
npm run migration:revert
```

### Seeding Data

Seed data can be added to the database using seed scripts:

```bash
# Run seed scripts
cd backend
npm run seed
```

### Database Backup and Restore

```bash
# Backup PostgreSQL database
pg_dump -U username -d database_name > backup.sql

# Restore PostgreSQL database
psql -U username -d database_name < backup.sql
```

## Deployment

### Building for Production

```bash
# Build backend
cd backend
npm run build

# Build frontend
cd frontend
npm run build
```

### Docker Deployment

The application can be deployed using Docker:

```bash
# Build Docker images
docker-compose build

# Start Docker containers
docker-compose up -d
```

### Environment Configuration

Environment-specific configuration is managed through environment variables:

```bash
# Production environment
NODE_ENV=production
DATABASE_URL=postgres://username:password@hostname:port/database
JWT_SECRET=your_jwt_secret
```

## Troubleshooting

### Common Issues

#### Permission Issues

1. **Permission not taking effect**: 
   - Check the permission hierarchy; a denial at a higher level overrides grants
   - Verify the resource and action names (case sensitive)
   - Check that permissions are properly loaded with `loadUserPermissions()`

2. **Inconsistent UI behavior**:
   - Make sure `hasPermissionSync()` is only used after permissions are loaded
   - Subscribe to `permissionsRefreshed$` to know when to refresh UI components

3. **Route guard not working**:
   - Verify route data has the correct `permissionRule` format
   - Ensure `PermissionGuard` is added to the `canActivate` array after `AuthGuard`

#### Database Issues

1. **Migration errors**:
   - Check that the database connection is properly configured
   - Ensure that the database user has sufficient privileges
   - Check for conflicts with existing tables or constraints

2. **Connection issues**:
   - Verify database connection string
   - Check network connectivity
   - Ensure database server is running

#### Frontend Issues

1. **Angular build errors**:
   - Check for TypeScript errors
   - Verify that all dependencies are installed
   - Check for circular dependencies

2. **Runtime errors**:
   - Check browser console for errors
   - Verify that API endpoints are accessible
   - Check for CORS issues

#### Backend Issues

1. **NestJS startup errors**:
   - Check for TypeScript errors
   - Verify that all dependencies are installed
   - Check for module dependency issues

2. **API errors**:
   - Check server logs for errors
   - Verify database connectivity
   - Check request/response format

### Getting Help

If you encounter issues not covered in this guide, please refer to:
- The API documentation
- Source code in the relevant modules
- Open an issue in the project repository
