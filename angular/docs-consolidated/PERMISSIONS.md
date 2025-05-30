# Permission System Documentation

## Overview

The permission system provides a flexible, database-driven approach to access control throughout the application. It replaces traditional hardcoded role-based checks with a dynamic permission system that can be managed through the admin interface without code changes.

The system is built around these core concepts:

- **Resources**: Things that can be protected (e.g., users, roles, reports)
- **Actions**: Operations that can be performed on resources (e.g., create, read, update, delete)
- **Permissions**: Combinations of resources and actions (e.g., users:create, reports:export)
- **Assignment**: Permissions can be assigned to roles, groups, or individual users

## Key Features

- **Hierarchical Inheritance**: Permissions cascade from roles to users and from groups to users
- **Multiple Assignment Levels**: Permissions can be assigned at the role, group, or user level
- **Explicit Deny Capability**: Can explicitly deny a permission to override inherited permissions
- **Permission Caching**: Frontend caching for performance optimization
- **UI Integration**: Directive for conditional UI rendering based on permissions
- **Dynamic Component Registration**: Automatic discovery and registration of UI components
- **Database-Driven Access Control**: All permissions stored and managed in the database
- **Runtime Updates**: Change permissions without code deployment

## Architecture

### Backend Components

1. **Entities**
   - `Resource`: Represents a protectable resource (users, roles, etc.)
   - `Action`: Represents operations that can be performed (create, read, etc.)
   - `Permission`: Links a resource with an action
   - `RolePermission`: Associates permissions with roles
   - `GroupPermission`: Associates permissions with groups
   - `UserPermission`: Associates permissions directly with users
   - `UiComponent`: Tracks UI components with permission requirements
   - `FrontendRoute`: Tracks Angular routes with permission requirements
   - `ApiEndpoint`: Tracks API endpoints with permission requirements

2. **Services**
   - `PermissionsService`: Core service for checking and managing permissions
   - `ComponentScannerService`: Scans for components with permission requirements
   - `RouteScannerService`: Scans for routes with permission requirements
   - `EndpointScannerService`: Scans for API endpoints with permission requirements
   - `CacheService`: Provides high-performance permission checks
   - `PermissionSyncService`: Synchronizes permissions between code and database

3. **Guards and Decorators**
   - `@RequirePermission()`: Decorator for protecting controller methods
   - `@RequireAllPermissions()`: Decorator requiring multiple permissions
   - `PermissionGuard`: NestJS guard that enforces permission checks
   - `@RegisterPermissionComponent()`: Decorator for registering UI components

For more details on the backend architecture, see the [Architecture Documentation](ARCHITECTURE.md#backend-architecture).

### Frontend Components

1. **Services**
   - `PermissionService`: Handles permission checking and caching

2. **Directives and Guards**
   - `*appHasPermission`: Directive for conditional UI rendering
   - `PermissionGuard`: Angular route guard for permission-based routing

For more details on the frontend architecture, see the [Architecture Documentation](ARCHITECTURE.md#frontend-architecture).

## Permission Hierarchy

Permissions are evaluated in this order (highest priority first):

1. **User-specific permissions**: Direct grants/denies to a user
2. **Role-based permissions**: Permissions from the user's assigned role
3. **Group-based permissions**: Permissions from the user's groups

If a permission is explicitly denied at any level, that denial takes precedence over grants at lower levels.

## Usage Guide

### Backend Usage

#### Securing API Endpoints

```typescript
// Require a single permission
@Get('users')
@UseGuards(PermissionGuard)
@RequirePermission('users:list')
getAllUsers() {
  // This endpoint requires 'users:list' permission
}

// Require any of multiple permissions
@Put('users/:id')
@UseGuards(PermissionGuard)
@RequirePermission(['users:update', 'users:manage'])
updateUser(@Param('id') id: number) {
  // This endpoint requires either 'users:update' or 'users:manage'
}

// Require all permissions
@Delete('users/:id')
@UseGuards(PermissionGuard)
@RequireAllPermissions(['users:delete', 'admin:access'])
deleteUser(@Param('id') id: number) {
  // This endpoint requires both 'users:delete' AND 'admin:access'
}
```

For more information about API endpoints, see the [API Documentation](API.md).

#### Programmatic Permission Checks

```typescript
// In a service or controller
async someMethod(userId: number) {
  // Check if the user has a specific permission
  const canCreateUsers = await this.permissionsService.checkUserPermission(
    userId, 'users', 'create'
  );

  if (canCreateUsers) {
    // Perform actions that require this permission
  }
}
```

### Frontend Usage

#### Securing Routes

```typescript
// In app-routing.module.ts
const routes: Routes = [
  {
    path: 'admin/users',
    component: UserManagementComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: {
      permissionRule: 'users:manage' // Single permission
    }
  },
  {
    path: 'reports',
    component: ReportsComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: {
      permissionRule: ['reports:view', 'reports:export'] // Any of these
    }
  }
];
```

#### Conditional UI Elements

```html
<!-- Show button only if user has permission -->
<button *hasPermission="'users:create'" (click)="createUser()">
  Create User
</button>

<!-- With array of permissions (any match) -->
<button *hasPermission="['users:create', 'admin:users']" (click)="createUser()">
  Create User
</button>

<!-- With else template -->
<button *hasPermission="'reports:export'; else noAccess" (click)="exportReport()">
  Export Report
</button>
<ng-template #noAccess>
  <button disabled>Export Report (No Access)</button>
</ng-template>
```

#### Programmatic Permission Checks

```typescript
// In a component
constructor(private permissionService: PermissionService) {}

someMethod() {
  // Check with observable response (preferred for most cases)
  this.permissionService.hasPermission('users:create')
    .subscribe(canCreate => {
      if (canCreate) {
        // Perform actions requiring this permission
      }
    });

  // Check with resource and action as separate parameters
  this.permissionService.hasPermission('users', 'create')
    .subscribe(canCreate => {
      if (canCreate) {
        // Perform actions requiring this permission
      }
    });

  // Synchronous check (only works if permissions are already loaded)
  const canViewReports = this.permissionService.hasPermissionSync('reports:view');

  // Check multiple permissions (any match)
  this.permissionService.hasAnyPermission([
    'users:view',
    'roles:view'
  ]).subscribe(hasAnyPermission => {
    if (hasAnyPermission) {
      // User has at least one of the permissions
    }
  });

  // Check multiple permissions (all must match)
  this.permissionService.hasAllPermissions([
    'users:manage',
    'roles:manage'
  ]).subscribe(hasAllPermissions => {
    if (hasAllPermissions) {
      // User has all specified permissions
    }
  });
}
```

## Dynamic Component Registration

UI components can be automatically registered and managed through the database:

### Component Registration

Components are registered using decorators:

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

### Smart Defaults

The system supports smart defaults based on naming conventions:

```typescript
// Component named UserCreateButtonComponent will automatically
// be assigned the permission 'users:create' based on naming
@Component({
  selector: 'app-user-create-button',
  template: '<button>Create User</button>'
})
export class UserCreateButtonComponent {}
```

## Performance Optimization

### SQLite Cache Database

To address performance concerns with database-driven permissions, the system uses a dedicated SQLite cache database:

1. **Initial Load**: All permissions are loaded from the primary database on server startup
2. **Cache Storage**: Permissions are stored in a local SQLite database for quick access
3. **Periodic Sync**: The cache is synchronized with the primary database at configurable intervals
4. **Memory Caching**: Frequently accessed permissions are additionally cached in memory

```typescript
// Configuration for SQLite cache database
const cacheConfig: TypeOrmModuleOptions = {
  type: 'sqlite',
  database: 'cache/permissions.sqlite',
  entities: [/* Cache entities */],
  synchronize: true
};
```

### Cache Database Structure

The cache database consists of several tables:

1. **`cache_components`**: Stores UI component metadata and permission requirements
2. **`cache_routes`**: Stores route information and permission requirements
3. **`cache_endpoints`**: Stores API endpoint information and permission requirements
4. **`cache_permission_maps`**: Stores denormalized permission mappings for quick lookups
5. **`cache_sync_status`**: Tracks synchronization status between the main database and cache

### Synchronization Process

The cache database is kept in sync with the main database through these mechanisms:

1. **Startup Sync**: The cache is synchronized when the application starts
2. **Scheduled Sync**: A background job runs every 5 minutes to update the cache
3. **Manual Sync**: Administrators can trigger a manual sync through the admin interface
4. **Event-Based Sync**: When permissions are modified, the cache is automatically updated

### Cache Administration

Administrators can monitor the cache status through the API:

```
GET /permissions/cache/status
```

This endpoint returns information about the last synchronization, including:
- Timestamp of the last sync
- Success/failure status
- Sync statistics (added, updated, deleted records)
- Error messages (if any)

If needed, administrators can force a full synchronization:

```
POST /permissions/cache/sync
```

### Cache Location and Management

The SQLite cache database is stored at:

```
/path/to/app/cache/permissions.sqlite
```

This file can be backed up, but should not be manually edited. It is regenerated automatically by the application.

### Troubleshooting Cache Issues

Common issues with the permission cache include:

1. **Permissions Not Updating**: If permission changes don't seem to take effect, try forcing a manual sync.

2. **Performance Degradation**: If the application is slow to check permissions, ensure the cache synchronization is working properly.

3. **Database Lock Errors**: SQLite can encounter locking issues if multiple processes try to write to it simultaneously. The application has built-in retry mechanisms, but in rare cases you may need to restart the application.

### Optimization Strategies

Multiple caching strategies are implemented:

1. **In-memory LRU Cache**: Fast access for frequently used permissions
2. **Denormalized Tables**: Pre-computed permission maps
3. **Batch Loading**: Permissions are loaded in batches for efficiency
4. **Hierarchical Cache**: Permissions include inherited permissions from parent roles/groups

For more information about performance optimization, see the [Performance Optimization section](ARCHITECTURE.md#performance-optimization) in the Architecture Documentation.

## Administrative Management

Permissions can be managed through the admin interface at `/admin/permissions`. This interface allows administrators to:

1. Create/edit resources and actions
2. Create/edit permissions (resource + action combinations)
3. Assign permissions to roles
4. Assign permissions to groups
5. Assign permissions directly to users (overrides)
6. View and manage UI components
7. View and manage routes
8. View and manage API endpoints

## Best Practices

1. **Role-Based Default**: Assign most permissions at the role level
2. **Group-Based Specialization**: Use groups for cross-cutting concerns (e.g., department-specific permissions)
3. **User Overrides**: Use user-specific permissions sparingly, mostly for exceptions
4. **Permission Naming**: Follow the convention `resource:action` (e.g., `users:create`)
5. **Frontend Caching**: Call `loadUserPermissions()` after login and token refresh
6. **Testing**: Write tests that explicitly verify permission checks
7. **Resource:Action naming**: Use a consistent naming convention for permissions
8. **Minimal permissions**: Assign the minimum permissions necessary for each role or group
9. **Use groups for organizational structure**: Assign permissions based on organizational structure through groups
10. **Use roles for job functions**: Assign permissions based on job functions through roles
11. **Regular scanning**: Run the permission scanner regularly to keep the system up to date with code changes

For more information about testing permissions, see the [Testing Permissions section](DEVELOPMENT.md#testing-permissions) in the Development Guide.

## Troubleshooting

### Common Issues

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

4. **Directive not working**:
   - Make sure the directive is properly applied to the HTML element with the correct syntax

5. **Scanner not finding components**:
   - Ensure components use the correct syntax for the permission directive

For more troubleshooting information, see the [Troubleshooting section](DEVELOPMENT.md#troubleshooting) in the Development Guide.

### Debugging Tools

1. **Frontend Cache Inspection**:
   ```typescript
   // In browser console
   const permService = ng.getService(PermissionService);
   console.log([...permService.permissionsCache.entries()]);
   ```

2. **Backend Permission Verification**:
   ```bash
   # API endpoint to check a specific permission
   GET /api/permissions/check/users/create?userId=123
   ```

3. **Enable debug mode**:
   ```typescript
   // In app.module.ts
   PermissionModule.forRoot({
     debug: true
   })
   ```

For more information about debugging, see the [Debugging and Logging section](DEVELOPMENT.md#debugging-and-logging) in the Development Guide.
