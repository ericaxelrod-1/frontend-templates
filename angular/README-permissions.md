# Dynamic Access Control System

A flexible, database-driven permission system that eliminates hardcoded roles and permissions from the codebase.

## Key Features

- **Database-Driven Permissions**: All permission rules are stored in the database, not in code
- **Automatic Discovery**: Automatically finds components, routes, and endpoints that need permissions
- **SQLite Cache**: High-performance permission checks using a denormalized SQLite cache
- **Multi-Level Assignment**: Permissions can be assigned to roles, groups, or individual users
- **Frontend Integration**: Directives and guards for conditional UI rendering and route protection

## Architecture Overview

![Architecture Diagram](docs/images/permissions-architecture.png)

The system consists of:

1. **Permission Database**: Stores resources, actions, permissions, and their assignments
2. **SQLite Cache**: Provides fast permission lookups for runtime checks
3. **Scanner System**: Discovers permission requirements from code annotations
4. **Backend Guards**: Enforces permissions on API endpoints
5. **Frontend Components**: Directives and guards for UI-level permission enforcement

## Usage Examples

### Protecting Backend Endpoints

```typescript
@Controller('reports')
export class ReportsController {
  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermissions('reports:export')
  exportReport() {
    // Implementation
  }
}
```

### Protecting Frontend Routes

```typescript
const routes: Routes = [
  {
    path: 'admin/users',
    component: UserManagementComponent,
    canActivate: [PermissionGuard],
    data: { requiredPermissions: ['users:manage'] }
  }
];
```

### Conditional UI Rendering

```html
<button *hasPermission="'reports:export'">Export Report</button>

<!-- With multiple permissions (AND) -->
<div *hasPermission="['users:manage', 'reports:export']">
  Advanced Admin Controls
</div>
```

## How It Works

1. **Discovery**: When the application starts, scanners discover all permission requirements
2. **Registration**: Discovered permissions are registered in the database
3. **Caching**: Permissions are cached in SQLite for fast runtime access
4. **Enforcement**: Guards and directives check permissions at runtime
5. **Synchronization**: The cache is kept in sync with the main database

## Benefits

- **Decoupling**: Permissions logic is decoupled from business logic
- **Flexibility**: Permissions can be changed without modifying code
- **Performance**: Fast permission checks through caching
- **Maintainability**: Centralized permission management
- **Security**: Consistent permission enforcement across the application

## Documentation

For detailed documentation, see:

- [Permissions System Overview](docs/permissions-system.md)
- [API Reference](docs/permissions-api.md)
- [Frontend Usage Guide](docs/permissions-frontend.md)
- [Backend Integration](docs/permissions-backend.md) 