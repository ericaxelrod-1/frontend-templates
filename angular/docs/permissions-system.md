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

## Architecture

### Backend Components

1. **Entities**
   - `Resource`: Represents a protectable resource (users, roles, etc.)
   - `Action`: Represents operations that can be performed (create, read, etc.)
   - `Permission`: Links a resource with an action
   - `RolePermission`: Associates permissions with roles
   - `GroupPermission`: Associates permissions with groups
   - `UserPermission`: Associates permissions directly with users

2. **Services**
   - `PermissionsService`: Core service for checking and managing permissions

3. **Guards and Decorators**
   - `@RequirePermission()`: Decorator for protecting controller methods
   - `@RequireAllPermissions()`: Decorator requiring multiple permissions
   - `PermissionGuard`: NestJS guard that enforces permission checks

### Frontend Components

1. **Services**
   - `PermissionService`: Handles permission checking and caching

2. **Directives and Guards**
   - `*appHasPermission`: Directive for conditional UI rendering
   - `PermissionGuard`: Angular route guard for permission-based routing

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

#### Testing Permission Directives

The directive includes comprehensive tests to verify its functionality:

```bash
# Run directive tests
cd angular/frontend
npm test -- --include=src/app/shared/directives/has-permission.directive.spec.ts
```

This launches Karma test runner in Chrome, executing only the directive tests to verify:
1. Elements are correctly shown/hidden based on permissions
2. Both string and array permission formats work as expected
3. Permission changes are reflected in the UI
4. The else template is correctly displayed when permissions are denied

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

## Administrative Management

Permissions can be managed through the admin interface at `/admin/permissions`. This interface allows administrators to:

1. Create/edit resources and actions
2. Create/edit permissions (resource + action combinations)
3. Assign permissions to roles
4. Assign permissions to groups
5. Assign permissions directly to users (overrides)

## Best Practices

1. **Role-Based Default**: Assign most permissions at the role level
2. **Group-Based Specialization**: Use groups for cross-cutting concerns (e.g., department-specific permissions)
3. **User Overrides**: Use user-specific permissions sparingly, mostly for exceptions
4. **Permission Naming**: Follow the convention `resource:action` (e.g., `users:create`)
5. **Frontend Caching**: Call `loadUserPermissions()` after login and token refresh
6. **Testing**: Write tests that explicitly verify permission checks

## Examples

### Creating a New Permission

```typescript
// In seed service or admin controller
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

### Assigning Permissions to a Role

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

## Advanced Topics

### Custom Permission Logic

For complex permission scenarios, you can extend the `PermissionsService` with custom logic:

```typescript
// Custom permission check method
async checkComplexPermission(userId: number, contextData: any): Promise<boolean> {
  // Basic permission check
  const hasBasePermission = await this.checkUserPermission(
    userId, 'documents', 'edit'
  );
  
  if (!hasBasePermission) {
    return false;
  }
  
  // Additional business logic
  if (contextData.ownerId === userId) {
    return true; // User can always edit their own documents
  }
  
  // Department-specific checks, etc.
  return moreComplexChecks();
}
```

### Parent-Child Hierarchies

Both roles and groups support parent-child relationships:

```typescript
// Create a role hierarchy
const adminRole = await roleRepository.save({
  name: 'admin',
  description: 'Administrator'
});

const superAdminRole = await roleRepository.save({
  name: 'superadmin',
  description: 'Super Administrator',
  parentId: adminRole.id // Inherits from admin
});
```

Permissions propagate from parent to child, unless explicitly denied at the child level.

## Fully Dynamic Access Control System

The permission system has been extended to provide a fully dynamic database-driven approach for controlling access to UI components, frontend routes, and API endpoints. This eliminates the need for hardcoded permission checks and allows for runtime changes without code deployment.

### Dynamic UI Components

UI components can be automatically registered and managed through the database:

#### Component Registration

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

#### Smart Defaults

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

### Dynamic Routes

Routes can be protected based on database-defined permissions:

```typescript
const routes: Routes = [
  {
    path: 'admin/users',
    component: UserManagementComponent,
    // This metadata will be synchronized to the database
    data: {
      permissionId: 'admin_users_route',
      description: 'User Management Page',
      requiredPermissions: ['users:manage']
    }
  }
];
```

### Dynamic API Endpoints

API endpoints use decorators to register with the permission system:

```typescript
@Controller('users')
export class UsersController {
  @Get()
  @RegisterEndpoint({
    id: 'list_users_endpoint',
    description: 'List all users',
    requiredPermissions: ['users:list']
  })
  listUsers() {
    // Implementation
  }
}
```

### Performance Optimization

#### SQLite Cache Database

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

**Note**: The SQLite cache database is used exclusively for performance optimization and will not be part of the database migration when moving to production.

#### Optimization Strategies

Multiple caching strategies are implemented:

1. **In-memory LRU Cache**: Fast access for frequently used permissions
2. **Denormalized Tables**: Pre-computed permission maps
3. **Batch Loading**: Permissions are loaded in batches for efficiency
4. **Hierarchical Cache**: Permissions include inherited permissions from parent roles/groups

### Auto-Registration System

The system includes an automated registration process for discovering and synchronizing code-defined components with the database:

#### Component Scanner

The component scanner processes application code at configurable intervals:

```typescript
@Injectable()
export class ComponentScannerService {
  // Scans the application for components with RegisterPermissionComponent decorator
  async scanComponents(): Promise<ComponentManifest> {
    // Implementation
  }
}
```

#### Manifest Generation

A JSON manifest is generated containing all discovered components, routes, and endpoints:

```json
{
  "components": [
    {
      "id": "create_user_btn",
      "description": "Create User Button",
      "requiredPermissions": ["users:create"]
    }
  ],
  "routes": [
    {
      "path": "admin/users",
      "id": "admin_users_route",
      "description": "User Management Page",
      "requiredPermissions": ["users:manage"]
    }
  ],
  "endpoints": [
    {
      "path": "GET /api/users",
      "id": "list_users_endpoint",
      "description": "List all users",
      "requiredPermissions": ["users:list"]
    }
  ]
}
```

#### Database Synchronization

The manifest is compared with database records to ensure consistency:

```typescript
@Injectable()
export class PermissionSyncService {
  // Synchronizes the component manifest with the database
  async synchronizeManifest(manifest: PermissionManifest): Promise<SyncResult> {
    // Compare with database records
    // Create missing permissions
    // Update changed permissions
    // Generate alerts for missing permissions
  }
}
```

### Admin Interface

The permission system includes an admin interface for managing dynamic permissions:

#### Permission Dashboard Card

A new admin dashboard card provides:

- **Sync Status**: Current status of permission synchronization
- **Alerts**: Notifications about missing or inconsistent permissions
- **Manual Sync**: Button to trigger manual synchronization
- **Reports**: Detailed permission status reports

#### Component Management

The admin interface allows for viewing and managing UI components:

- List all registered components
- Assign or modify permissions
- Override default permissions
- View component hierarchies

#### Route Management

Routes can be managed through the interface:

- View all registered routes
- Modify required permissions
- Test route access
- View route hierarchies

#### API Endpoint Management

The interface provides control over API endpoints:

- List all registered endpoints
- Assign or modify permissions
- Test endpoint access
- View controller hierarchies

### Deployment Considerations

When deploying the dynamic permission system:

1. **Database Migration**:
   - Main database tables will be migrated with the application
   - SQLite cache will be regenerated on each environment

2. **Startup Procedure**:
   - Initial sync occurs on application startup
   - Cache database is created if not present
   - Periodic scans are scheduled

3. **Environment Configuration**:
   - Scan intervals are configurable per environment
   - Cache strategies can be adjusted based on deployment size

4. **Monitoring**:
   - System includes monitoring for sync failures
   - Performance metrics track permission resolution times
   - Alerts notify administrators of permission inconsistencies

# Dynamic Access Control System

This document explains the implementation of the Dynamic Access Control system, which allows for flexible permission management without hardcoding roles or permissions in the application.

## Overview

The Dynamic Access Control system consists of several components:

1. **Backend Permission System**: Manages permissions, resources, actions, and their relationships.
2. **SQLite Cache**: Provides fast permission lookups through a denormalized data structure.
3. **Scanner Services**: Automatically discovers components, routes, and endpoints with permission requirements.
4. **Guards and Directives**: Enforces permission rules at both backend and frontend levels.

## Key Concepts

### Resources and Actions

Permissions are based on the concept of resources and actions:

- **Resource**: An entity or module in the system (e.g., `users`, `reports`, `dashboard`)
- **Action**: An operation on a resource (e.g., `read`, `create`, `update`, `delete`)

A permission combines a resource and an action (e.g., `users:read`).

### Permission Assignment

Permissions can be assigned at three levels, with increasing specificity and priority:

1. **Role-based permissions**: Assigned to roles, which are then assigned to users.
2. **Group-based permissions**: Assigned to groups, which can contain multiple users.
3. **User-specific permissions**: Directly assigned to individual users.

Each level can explicitly grant or deny a permission, with higher levels overriding lower levels.

## Backend Components

### Entities

- `Resource`: Represents a system resource
- `Action`: Represents an action that can be performed
- `Permission`: Links a resource and an action
- `RolePermission`: Associates permissions with roles
- `GroupPermission`: Associates permissions with groups
- `UserPermission`: Associates permissions with users

### Cache Entities

- `CachePermissionMap`: Denormalized permissions for fast lookups
- `CacheComponent`: Frontend components with permission requirements
- `CacheRoute`: Frontend routes with permission requirements
- `CacheEndpoint`: Backend endpoints with permission requirements
- `CacheSyncStatus`: Tracks synchronization status

### Scanner Services

- `ComponentScannerService`: Scans frontend components for permission annotations
- `RouteScannerService`: Scans routing modules for permission requirements
- `EndpointScannerService`: Scans backend controllers for permission decorators
- `ManifestService`: Coordinates scanners and builds a permission manifest

### Guards and Decorators

- `PermissionGuard`: Protects backend routes based on permissions
- `RequirePermissions`: Decorator to specify required permissions for endpoints

## Frontend Components

### Services

- `PermissionService`: Communicates with the backend for permission checks
- `PermissionInterceptor`: Handles permission-related HTTP errors

### Directives and Guards

- `HasPermissionDirective`: Conditionally shows/hides UI elements based on permissions
- `PermissionGuard`: Protects frontend routes based on permissions

## Usage Examples

### Backend

1. **Protect a controller endpoint**:

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

2. **Check permissions in a service**:

```typescript
@Injectable()
export class ReportService {
  constructor(private permissionsService: PermissionsService) {}
  
  async generateReport(userId: number) {
    const canExport = await this.permissionsService.checkUserPermission(
      userId, 'reports', 'export'
    );
    
    if (!canExport) {
      throw new ForbiddenException('No permission to export reports');
    }
    
    // Generate report
  }
}
```

### Frontend

1. **Protect a route**:

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

2. **Conditionally show UI elements**:

```html
<button *hasPermission="'reports:export'">Export Report</button>

<!-- With multiple permissions (AND) -->
<div *hasPermission="['users:manage', 'reports:export']">
  Advanced Admin Controls
</div>

<!-- With OR logic -->
<div *hasPermission="['users:view', 'reports:view']" [hasPermissionOp]="'OR'">
  View Content
</div>
```

## Cache Synchronization

The system automatically keeps the SQLite cache in sync with the main database through:

1. Initial synchronization when the application starts
2. Scheduled synchronization every 5 minutes
3. Manual synchronization via the API

## Permission Discovery

The system automatically discovers permission requirements by scanning:

1. Frontend components with `@RequirePermissions` decorators
2. Angular routing modules with `PermissionGuard`
3. Backend controllers with `@RequirePermissions` decorators

## Best Practices

1. **Never hardcode roles or groups** in permission checks
2. Use the `hasPermission` directive for UI elements
3. Use the `PermissionGuard` for route protection
4. Use the `RequirePermissions` decorator for backend endpoints
5. Define permissions using resource:action format
6. Assign permissions through the admin interface, not in code
7. Prefer role-based permissions for broad access control
8. Use group and user permissions for exceptions 