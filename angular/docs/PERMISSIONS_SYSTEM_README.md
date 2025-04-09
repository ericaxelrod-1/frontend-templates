# Dynamic Access Control System - Quick Start Guide

This README provides step-by-step instructions for setting up and using the dynamic access control system in the application.

## Setup Instructions

Follow these steps to set up the permissions system:

### 1. Check Dependencies

First, ensure all required dependencies are installed:

```bash
cd angular/backend
npm run permissions:check-deps
```

This will automatically install any missing dependencies required by the permissions system.

### 2. Run Database Migrations

Create the necessary database tables:

```bash
cd angular/backend
npm run migration:run
```

This will create all required tables for the permissions system, including:
- permission
- role
- group
- ui_components
- frontend_routes
- api_endpoints
- Various junction tables for relationships

### 3. Scan Application for Permission Requirements

Scan the application to detect components, routes, and endpoints with permission requirements:

```bash
cd angular/backend
npm run permissions:scan
```

This will:
- Scan frontend components for `*appHasPermission` directives
- Scan Angular routes for permission guards
- Scan backend controllers for `@RequirePermission()` decorators
- Create permissions in the database based on the scan results

### 4. Configure Permissions in the Admin Dashboard

1. Start the application
2. Log in as an admin user
3. Navigate to the Admin > Permissions Management page
4. Configure roles, groups, and assign permissions as needed

## Using the Permissions System

### Frontend Components

Use the `appHasPermission` directive to conditionally display UI elements:

```html
<div *appHasPermission="'dashboard:view'">Dashboard content</div>
```

### Angular Routes

Protect routes using the permission guard:

```typescript
{
  path: 'admin',
  component: AdminComponent,
  canActivate: [PermissionGuard],
  data: { permissions: ['admin:view'] }
}
```

### Backend Controllers

Protect API endpoints using the `@RequirePermission()` decorator:

```typescript
@Get()
@RequirePermission('users:view')
async findAll() {
  return this.usersService.findAll();
}
```

## Common Commands

- `npm run permissions:scan` - Scan the application for permission requirements
- `npm run migration:run` - Run database migrations
- `npm run permissions:check-deps` - Check and install dependencies
- `npm run sync:permissions-cache` - Manually refresh the permissions cache

## Documentation

For detailed documentation, see:

- [DYNAMIC_ACCESS_CONTROL.md](./DYNAMIC_ACCESS_CONTROL.md) - Comprehensive guide to the permissions system
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - Database schema details
- API documentation for individual components

## Troubleshooting

If you encounter issues with the permissions system:

1. Ensure all migrations have been run
2. Verify that the permissions cache has been refreshed
3. Check that permissions are correctly assigned to roles and groups
4. Run the permissions scanner to update the database with any new permission requirements

For more assistance, refer to the Troubleshooting section in [DYNAMIC_ACCESS_CONTROL.md](./DYNAMIC_ACCESS_CONTROL.md). 