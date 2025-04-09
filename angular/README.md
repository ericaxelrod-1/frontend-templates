# Angular Application with Dynamic Permissions

This is a modern Angular application with a NestJS backend that features a comprehensive, fully dynamic database-driven access control system.

## Key Features

- **Dynamic Permission System**: Completely database-driven access control without any hardcoded permissions
- **UI Component Registration**: Automatic discovery and registration of UI components with permissions
- **Dynamic Route Protection**: Database-defined protection for application routes
- **API Endpoint Security**: Dynamic permission checks for backend endpoints
- **Hierarchical Permissions**: Full inheritance support for roles, groups, and nested components
- **Performance Optimization**: SQLite cache database for high-performance permission checks
- **Admin Interface**: Complete management UI for permissions across all application elements
- **Angular Frontend**: Modern, responsive UI built with Angular
- **NestJS Backend**: Robust API with TypeScript support
- **TypeORM Integration**: Database ORM for entity management

## Project Structure

```
angular/
├── frontend/          # Angular frontend application
├── backend/           # NestJS backend application
└── docs/              # Project documentation
```

## Dynamic Access Control System

The application features a comprehensive dynamic access control system:

- **Code-First Approach**: Register components, routes, and endpoints with simple decorators
- **Smart Defaults**: Automatic permission mapping based on naming conventions
- **Database-Driven**: All permissions stored and managed in the database
- **Runtime Updates**: Change permissions without code deployment
- **Component Scanner**: Automatically discovers and registers UI components
- **Performance Caching**: Optimized with SQLite cache and memory caching
- **Admin Dashboard**: Real-time monitoring of permissions and synchronization status

For detailed documentation on the permission system, see [Permission System Documentation](docs/permissions-system.md).

## Getting Started

### Prerequisites

- Node.js (v14+)
- npm or yarn
- PostgreSQL database

### Backend Setup

```bash
cd backend
npm install
npm run migration:run
npm run start:dev
```

### Frontend Setup

```bash
cd frontend
npm install
npm start
```

The application will be available at `http://localhost:4200` with the API running at `http://localhost:3000`.

## Development

### Running Tests

```bash
# Backend tests
cd backend
npm run test

# Frontend tests
cd frontend
npm run test

# Test specific files (e.g., a directive)
cd frontend
npm test -- --include=src/app/shared/directives/has-permission.directive.spec.ts
```

#### Testing UI Permission Directives

The application uses structural directives like `*hasPermission` to control UI element visibility based on user permissions. Testing these directives is crucial to ensure:

1. UI elements are correctly shown/hidden based on permissions
2. Permission changes trigger appropriate UI updates
3. Both string and array permission formats work as expected
4. Fallback templates render correctly when permissions are denied

When to run directive tests:
- After modifying the permission directive implementation
- When changing the PermissionService integration
- After updating permission format requirements
- Before deploying permission-critical features

Example of a directive test run:
```bash
cd angular/frontend
npm test -- --include=src/app/shared/directives/has-permission.directive.spec.ts
```

This launches Karma test runner in Chrome, executing only the specified test file.

### Building for Production

```bash
# Build backend
cd backend
npm run build

# Build frontend
cd frontend
npm run build
```

## Documentation

- [Permission System](docs/permissions-system.md)
- [API Documentation](docs/api-docs.md)
- [Frontend Components](docs/frontend-components.md)
- [Access Control Audit Plan](docs/access-control-audit-plan.md)
- [Security Guide](docs/security.md)
- [Current State](docs/CURRENT_STATE.md)
- [Implementation Steps](docs/IMPLEMENTATION_STEPS.md)

## License

This project is licensed under the MIT License - see the LICENSE file for details. 