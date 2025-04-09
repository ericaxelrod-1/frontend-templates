# Migrating to Dynamic Access Control

This directory contains migration tools and templates for transitioning from the current hardcoded role-based access control system to a dynamic, database-driven permission system with hierarchical roles and groups.

## Overview

The audit script has identified multiple instances of hardcoded role checks throughout the codebase. This migration addresses these issues by implementing a hierarchical, database-driven permission system that supports:

1. **Hierarchical Roles** - Roles inherit permissions from parent roles
2. **Group-based Access Control** - Users can belong to groups, which have their own permission sets
3. **Direct User Permissions** - Individual exceptions can be granted or denied at the user level
4. **Resource-based Permissions** - Fine-grained control using resource:action pairs instead of monolithic roles

## Files in this Directory

- **permission.guard.ts** - New guard that checks permissions based on resource:action pairs
- **permission.service.ts** - Service for checking and managing user permissions
- **has-permission.directive.ts** - Structural directive for template permission checks
- **role-permission-schema.sql** - Database schema changes for the new permission system
- **route-migration-example.ts** - Example of migrating route configuration
- **permissions.controller.ts** - Backend controller for managing permissions

## Migration Steps

### 1. Database Setup

Run the `role-permission-schema.sql` script to create the necessary database tables:

```bash
# PostgreSQL
psql -U <username> -d <database> -f role-permission-schema.sql

# MySQL
mysql -u <username> -p <database> < role-permission-schema.sql

# Or use your ORM migration system
```

### 2. Backend Implementation

1. Create the permission entity, DTO, and repository
2. Implement the permission service and controller
3. Create the permission guard and required permission decorator
4. Update existing role-related code to use the new permission system

### 3. Frontend Implementation

1. Add the permission service to core services
2. Replace the role guard with the permission guard
3. Update route configuration to use permission data instead of role arrays
4. Replace ngIf role checks with the hasPermission directive

### 4. Migration Strategy

The migration should follow a phased approach:

1. **Phase 1: Infrastructure** - Implement the database schema and core services without changing existing functionality
2. **Phase 2: Backend Migration** - Update backend controllers and guards to use the new permission system
3. **Phase 3: Frontend Framework** - Add permission services and directives to the frontend
4. **Phase 4: Component Migration** - Update individual components and templates
5. **Phase 5: Testing & Optimization** - Thoroughly test the new system and optimize performance

## Converting Role Checks to Permissions

### Route Guards

Before:
```typescript
{
  path: 'admin',
  canActivate: [AuthGuard, RoleGuard],
  data: { roles: ['ADMIN', 'SUPERADMIN'] }
}
```

After:
```typescript
{
  path: 'admin',
  canActivate: [AuthGuard, PermissionGuard],
  data: { 
    permission: {
      resource: 'admin',
      action: 'access'
    }
  }
}
```

### Template Checks

Before:
```html
<div *ngIf="authService.hasRole('ADMIN')">Admin content</div>
```

After:
```html
<div *hasPermission="{ resource: 'admin', action: 'access' }">Admin content</div>
```

### Component Checks

Before:
```typescript
if (this.authService.hasRole('ADMIN')) {
  // Admin-only logic
}
```

After:
```typescript
this.permissionService.hasPermission('admin', 'access').subscribe(hasPermission => {
  if (hasPermission) {
    // Admin-only logic
  }
});
```

## Performance Considerations

The new permission system involves more complex database queries and potentially more HTTP requests. To mitigate performance issues:

1. **Caching** - Cache user permissions client-side
2. **Bulk Permission Loading** - Load all permissions for a user in one request
3. **Lazy Permission Checks** - Only check permissions when needed
4. **Permission Tree Optimization** - Use efficient algorithms for traversing permission trees

## Rollback Plan

In case of issues, a rollback can be performed by:

1. Reverting the database schema changes
2. Removing the new permission-related code
3. Restoring the original role-based security checks

## Monitoring and Logging

The migration includes enhanced logging for security-related actions:

1. All permission checks are logged
2. Permission changes are audited
3. Access denied events are tracked

This helps with debugging during the migration and provides better security oversight. 