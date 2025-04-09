# Dynamic Access Control System Guide

This guide explains how to use the dynamic access control system implemented in our application.

## Table of Contents

1. [Overview](#overview)
2. [Key Components](#key-components)
3. [Backend Implementation](#backend-implementation)
4. [Frontend Implementation](#frontend-implementation)
5. [Database Schema](#database-schema)
6. [Setup and Configuration](#setup-and-configuration)
7. [Usage Guide](#usage-guide)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

## Overview

The dynamic access control system provides a flexible and powerful way to manage permissions across the application. It follows a resource-action permission model, where permissions are defined as combinations of resources (users, roles, dashboard, etc.) and actions (view, create, edit, delete, etc.).

Key features:
- Database-driven permission management
- Role-based access control
- Group-based access control
- Dynamic permission scanning
- Caching for performance
- Component, route, and API endpoint permission integration

## Key Components

The system consists of the following key components:

### Backend Components

1. **Permission Entity:** Defines the structure of permissions in the system
2. **Role Entity:** Represents user roles with associated permissions
3. **Group Entity:** Represents user groups with associated permissions
4. **UiComponent Entity:** Tracks UI components with permission requirements
5. **FrontendRoute Entity:** Tracks Angular routes with permission requirements
6. **ApiEndpoint Entity:** Tracks API endpoints with permission requirements
7. **RequirePermission Decorator:** Secures API endpoints
8. **PermissionGuard:** Enforces permissions at the controller/action level
9. **Scanner Services:** Detect permission requirements in the codebase
10. **CacheService:** Provides high-performance permission checks
11. **PermissionsService:** Core service for managing permissions

### Frontend Components

1. **HasPermissionDirective:** Controls visibility of UI elements based on permissions
2. **PermissionGuard:** Protects routes based on user permissions
3. **PermissionService:** Manages permission checks and caching

## Backend Implementation

### Securing API Endpoints

Use the `@RequirePermission()` decorator to secure your controller methods:

```typescript
import { RequirePermission } from '../modules/permissions/decorators/require-permission.decorator';

@Controller('users')
export class UsersController {
  @Get()
  @RequirePermission('users:view')
  async findAll() {
    // This endpoint requires 'users:view' permission
    return this.usersService.findAll();
  }

  @Post()
  @RequirePermission(['users:create'])
  async create(@Body() createUserDto: CreateUserDto) {
    // This endpoint requires 'users:create' permission
    return this.usersService.create(createUserDto);
  }
}
```

### Checking Permissions in Services

Inject the `PermissionsService` to check permissions programmatically:

```typescript
import { Injectable } from '@nestjs/common';
import { PermissionsService } from '../permissions/services/permissions.service';

@Injectable()
export class SomeService {
  constructor(private permissionsService: PermissionsService) {}

  async doSomething(userId: string) {
    // Check if user has the required permission
    const hasPermission = await this.permissionsService.userHasPermission(
      userId,
      'resource:action'
    );

    if (hasPermission) {
      // Proceed with the operation
    } else {
      throw new UnauthorizedException('Insufficient permissions');
    }
  }
}
```

## Frontend Implementation

### Securing UI Elements

Use the `appHasPermission` directive to conditionally display UI elements:

```html
<!-- Show element only if user has 'dashboard:view' permission -->
<div *appHasPermission="'dashboard:view'">
  Dashboard content
</div>

<!-- Show element if user has either 'users:edit' or 'users:view' permission -->
<button *appHasPermission="['users:edit', 'users:view']; logic: 'or'">
  Edit User
</button>

<!-- Show element if user has both 'settings:view' and 'settings:edit' permissions -->
<button *appHasPermission="['settings:view', 'settings:edit']; logic: 'and'">
  Advanced Settings
</button>
```

### Securing Routes

Configure route guards in your routing module:

```typescript
import { PermissionGuard } from './guards/permission.guard';

const routes: Routes = [
  {
    path: 'admin',
    component: AdminComponent,
    canActivate: [PermissionGuard],
    data: {
      permissions: ['admin:view']
    }
  },
  {
    path: 'settings',
    component: SettingsComponent,
    canActivate: [PermissionGuard],
    data: {
      permissions: ['settings:view'],
      requireAll: false // Requires any of the permissions (OR logic)
    }
  }
];
```

### Checking Permissions in Components

Inject the `PermissionService` to check permissions programmatically:

```typescript
import { Component } from '@angular/core';
import { PermissionService } from 'src/app/core/services/permission.service';

@Component({
  selector: 'app-some-component',
  templateUrl: './some-component.component.html'
})
export class SomeComponent {
  constructor(private permissionService: PermissionService) {}

  canEditUser() {
    return this.permissionService.hasPermission('users:edit');
  }

  canPerformAction() {
    // Check multiple permissions with AND logic
    return this.permissionService.hasAllPermissions(['resource1:action1', 'resource2:action2']);
  }

  canAccessFeature() {
    // Check multiple permissions with OR logic
    return this.permissionService.hasAnyPermission(['feature:access', 'feature:admin']);
  }
}
```

## Database Schema

The permission system relies on the following database tables:

1. **permission:** Stores individual permissions
2. **role:** Defines user roles
3. **group:** Defines user groups
4. **role_permissions:** Junction table linking roles to permissions
5. **group_permissions:** Junction table linking groups to permissions
6. **ui_components:** Stores UI components with permission requirements
7. **frontend_routes:** Stores Angular routes with permission requirements
8. **api_endpoints:** Stores API endpoints with permission requirements

For the full database schema, see [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md).

## Setup and Configuration

### Initial Setup

1. Run the database migrations to create the necessary tables:

```bash
npm run migration:run
```

2. Seed the initial permissions, roles, and groups:

```bash
npm run migration:run
```

3. Scan your codebase to detect components, routes, and endpoints with permission requirements:

```bash
npm run permissions:scan
```

4. Start the application and navigate to the Permission Management dashboard.

### Configuring Permissions

1. **Assign permissions to roles:** Navigate to the Role Management page and assign appropriate permissions to each role.
2. **Assign permissions to groups:** Navigate to the Group Management page and assign permissions to each group.
3. **Assign roles to users:** Navigate to the User Management page and assign roles to users.
4. **Assign users to groups:** Navigate to the User Management page and assign users to groups.

## Usage Guide

### Managing Permissions

1. **Create permissions:** Create new permissions through the Permissions Management UI.
2. **Managing roles:** Create, edit, and delete roles through the Role Management UI.
3. **Managing groups:** Create, edit, and delete groups through the Group Management UI.
4. **Managing users:** Assign users to roles and groups through the User Management UI.

### Testing Permissions

1. Navigate to the Permission Testing page
2. Select a user and permission to test
3. The system will display whether the user has the permission based on their roles and groups

### Refreshing Permissions

1. After making changes to permissions, roles, or groups, click the Refresh button in the Permissions Management UI to refresh the permissions cache.
2. If you've added new components, routes, or endpoints with permission requirements, run the scanner:

```bash
npm run permissions:scan
```

## Best Practices

1. **Resource:Action naming:** Use a consistent naming convention for permissions, such as "resource:action" (e.g., "users:create", "dashboard:view").
2. **Minimal permissions:** Assign the minimum permissions necessary for each role or group.
3. **Use groups for organizational structure:** Assign permissions based on organizational structure through groups.
4. **Use roles for job functions:** Assign permissions based on job functions through roles.
5. **Regular scanning:** Run the permission scanner regularly to keep the system up to date with code changes.
6. **Cache management:** Refresh the permissions cache after making significant changes to permissions, roles, or groups.

## Troubleshooting

### Common Issues

1. **Permission not working:** Ensure the permission is properly assigned to the user's role or group and that the cache has been refreshed.
2. **Directive not working:** Make sure the directive is properly applied to the HTML element with the correct syntax.
3. **Guard not working:** Verify that the route has the correct permissions configured in the route data.
4. **Scanner not finding components:** Ensure components use the correct syntax for the permission directive.

### Debugging

1. Enable debug mode in the permission service to log permission checks:

```typescript
// In app.module.ts
PermissionModule.forRoot({
  debug: true
})
```

2. Check the browser console for permission-related logs.
3. Verify permissions in the database using the Permission Management UI.

### Getting Help

If you encounter issues not covered in this guide, please refer to:
- The API documentation
- Source code in the permissions module
- Open an issue in the project repository

---

## Additional Resources

- Database Schema: [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
- API Documentation: [API_DOCS.md](./API_DOCS.md)
- Contribution Guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
