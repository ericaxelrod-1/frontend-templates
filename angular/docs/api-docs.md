# API Documentation

## Overview

This document describes the RESTful API endpoints for the permissions system. The API allows managing resources, actions, permissions, and their assignments to users, roles, and groups.

## Base URL

All API endpoints are prefixed with `/api`.

## Authentication

All API endpoints require authentication using JWT (JSON Web Token). Include the token in the Authorization header:

```
Authorization: Bearer YOUR_JWT_TOKEN
```

## Common Response Codes

- `200 OK`: Request was successful
- `201 Created`: Resource was successfully created
- `400 Bad Request`: Invalid request parameters
- `401 Unauthorized`: No authentication token or expired token
- `403 Forbidden`: User doesn't have permission to access the resource
- `404 Not Found`: Requested resource not found
- `500 Internal Server Error`: Server-side error

## Error Response Format

Error responses follow this format:

```json
{
  "statusCode": 400,
  "message": "Error message describing the issue",
  "error": "Bad Request"
}
```

## Permissions API Endpoints

### Resources

Resources represent entities that can be protected by permissions.

#### Get All Resources

```
GET /api/permissions/resources
```

**Required Permission**: `resources:list`

**Response**:

```json
[
  {
    "id": 1,
    "name": "users",
    "description": "User management"
  },
  {
    "id": 2,
    "name": "roles",
    "description": "Role management"
  }
]
```

#### Get Resource by ID

```
GET /api/permissions/resources/:id
```

**Required Permission**: `resources:read`

**Response**:

```json
{
  "id": 1,
  "name": "users",
  "description": "User management"
}
```

#### Create Resource

```
POST /api/permissions/resources
```

**Required Permission**: `resources:create`

**Request Body**:

```json
{
  "name": "reports",
  "description": "Report management"
}
```

**Response**: Returns the created resource with ID

#### Update Resource

```
PUT /api/permissions/resources/:id
```

**Required Permission**: `resources:update`

**Request Body**:

```json
{
  "name": "reports",
  "description": "Updated description"
}
```

**Response**: Returns the updated resource

#### Delete Resource

```
DELETE /api/permissions/resources/:id
```

**Required Permission**: `resources:delete`

**Response**: Status code 204 (No Content) if successful

### Actions

Actions represent operations that can be performed on resources.

#### Get All Actions

```
GET /api/permissions/actions
```

**Required Permission**: `actions:list`

**Response**:

```json
[
  {
    "id": 1,
    "name": "create",
    "description": "Create new items"
  },
  {
    "id": 2,
    "name": "read",
    "description": "Read items"
  }
]
```

#### Get Action by ID

```
GET /api/permissions/actions/:id
```

**Required Permission**: `actions:read`

**Response**:

```json
{
  "id": 1,
  "name": "create",
  "description": "Create new items"
}
```

#### Create Action

```
POST /api/permissions/actions
```

**Required Permission**: `actions:create`

**Request Body**:

```json
{
  "name": "export",
  "description": "Export data"
}
```

**Response**: Returns the created action with ID

#### Update Action

```
PUT /api/permissions/actions/:id
```

**Required Permission**: `actions:update`

**Request Body**:

```json
{
  "name": "export",
  "description": "Updated description"
}
```

**Response**: Returns the updated action

#### Delete Action

```
DELETE /api/permissions/actions/:id
```

**Required Permission**: `actions:delete`

**Response**: Status code 204 (No Content) if successful

### API Endpoints

API Endpoints represent the actual REST endpoints in the system that are protected by permissions.

#### Get All Endpoints

```
GET /api/permissions/endpoints
```

**Required Permission**: `endpoints:list`

**Response**:

```json
[
  {
    "id": 1,
    "path": "/api/users",
    "method": "GET",
    "description": "List all users",
    "requiredPermissions": ["users:list"]
  },
  {
    "id": 2,
    "path": "/api/roles",
    "method": "POST",
    "description": "Create a new role",
    "requiredPermissions": ["roles:create"]
  }
]
```

#### Get Endpoint by ID

```
GET /api/permissions/endpoints/:id
```

**Required Permission**: `endpoints:read`

**Response**:

```json
{
  "id": 1,
  "path": "/api/users",
  "method": "GET",
  "description": "List all users",
  "requiredPermissions": ["users:list"]
}
```

#### Update Endpoint Permissions

```
PUT /api/permissions/endpoints/:id/permissions
```

**Required Permission**: `endpoints:update`

**Request Body**:

```json
{
  "requiredPermissions": ["users:list", "users:read"]
}
```

**Response**: Returns the updated endpoint

#### Scan and Register Endpoints

```
POST /api/permissions/endpoints/scan
```

**Required Permission**: `endpoints:manage`

**Description**: Scans the application for all API endpoints and registers them in the system. This is typically done during application startup or after adding new endpoints.

**Response**:

```json
{
  "scanned": 25,
  "registered": 5,
  "updated": 2,
  "removed": 1
}
```

### ApiEndpointDto Structure

The `ApiEndpointDto` is used to represent API endpoints in the system. It contains the following properties:

- `path` (string): The URL path of the endpoint (e.g., "/api/users")
- `method` (string): The HTTP method (GET, POST, PUT, DELETE, etc.)
- `description` (string): A human-readable description of what the endpoint does

When an endpoint is registered in the system, additional properties are added:

- `id` (number): Unique identifier for the endpoint
- `requiredPermissions` (string[]): Array of permission strings required to access this endpoint
- `createdAt` (Date): When the endpoint was first registered
- `updatedAt` (Date): When the endpoint was last updated

### Permissions

Permissions are combinations of resources and actions.

#### Get All Permissions

```
GET /api/permissions
```

**Required Permission**: `permissions:list`

**Query Parameters**:
- `resourceId` (optional): Filter by resource ID
- `actionId` (optional): Filter by action ID

**Response**:

```json
[
  {
    "id": 1,
    "resourceId": 1,
    "actionId": 1,
    "resource": {
      "id": 1,
      "name": "users"
    },
    "action": {
      "id": 1,
      "name": "create"
    },
    "description": "Create users"
  }
]
```

#### Get Permission by ID

```
GET /api/permissions/:id
```

**Required Permission**: `permissions:read`

**Response**:

```json
{
  "id": 1,
  "resourceId": 1,
  "actionId": 1,
  "resource": {
    "id": 1,
    "name": "users"
  },
  "action": {
    "id": 1,
    "name": "create"
  },
  "description": "Create users"
}
```

#### Create Permission

```
POST /api/permissions
```

**Required Permission**: `permissions:create`

**Request Body**:

```json
{
  "resourceId": 1,
  "actionId": 2,
  "description": "Read users"
}
```

**Response**: Returns the created permission with ID

#### Update Permission

```
PUT /api/permissions/:id
```

**Required Permission**: `permissions:update`

**Request Body**:

```json
{
  "description": "Updated description"
}
```

**Response**: Returns the updated permission

#### Delete Permission

```
DELETE /api/permissions/:id
```

**Required Permission**: `permissions:delete`

**Response**: Status code 204 (No Content) if successful

### Role Permissions

Assigns permissions to roles.

#### Get Role Permissions

```
GET /api/roles/:roleId/permissions
```

**Required Permission**: `role-permissions:list`

**Response**:

```json
[
  {
    "roleId": 1,
    "permissionId": 1,
    "granted": true,
    "permission": {
      "id": 1,
      "resource": {
        "name": "users"
      },
      "action": {
        "name": "create"
      }
    }
  }
]
```

#### Assign Permission to Role

```
POST /api/roles/:roleId/permissions
```

**Required Permission**: `role-permissions:create`

**Request Body**:

```json
{
  "permissionId": 2,
  "granted": true
}
```

**Response**: Returns the created role permission assignment

#### Update Role Permission

```
PUT /api/roles/:roleId/permissions/:permissionId
```

**Required Permission**: `role-permissions:update`

**Request Body**:

```json
{
  "granted": false
}
```

**Response**: Returns the updated role permission assignment

#### Remove Permission from Role

```
DELETE /api/roles/:roleId/permissions/:permissionId
```

**Required Permission**: `role-permissions:delete`

**Response**: Status code 204 (No Content) if successful

### Group Permissions

Assigns permissions to groups.

#### Get Group Permissions

```
GET /api/groups/:groupId/permissions
```

**Required Permission**: `group-permissions:list`

**Response**:

```json
[
  {
    "groupId": 1,
    "permissionId": 1,
    "granted": true,
    "permission": {
      "id": 1,
      "resource": {
        "name": "users"
      },
      "action": {
        "name": "create"
      }
    }
  }
]
```

#### Assign Permission to Group

```
POST /api/groups/:groupId/permissions
```

**Required Permission**: `group-permissions:create`

**Request Body**:

```json
{
  "permissionId": 2,
  "granted": true
}
```

**Response**: Returns the created group permission assignment

#### Update Group Permission

```
PUT /api/groups/:groupId/permissions/:permissionId
```

**Required Permission**: `group-permissions:update`

**Request Body**:

```json
{
  "granted": false
}
```

**Response**: Returns the updated group permission assignment

#### Remove Permission from Group

```
DELETE /api/groups/:groupId/permissions/:permissionId
```

**Required Permission**: `group-permissions:delete`

**Response**: Status code 204 (No Content) if successful

### User Permissions

Assigns permissions directly to users, overriding role and group permissions.

#### Get User Permissions

```
GET /api/users/:userId/permissions
```

**Required Permission**: `user-permissions:list`

**Response**:

```json
[
  {
    "userId": 1,
    "permissionId": 1,
    "granted": true,
    "permission": {
      "id": 1,
      "resource": {
        "name": "users"
      },
      "action": {
        "name": "create"
      }
    }
  }
]
```

#### Assign Permission to User

```
POST /api/users/:userId/permissions
```

**Required Permission**: `user-permissions:create`

**Request Body**:

```json
{
  "permissionId": 2,
  "granted": true
}
```

**Response**: Returns the created user permission assignment

#### Update User Permission

```
PUT /api/users/:userId/permissions/:permissionId
```

**Required Permission**: `user-permissions:update`

**Request Body**:

```json
{
  "granted": false
}
```

**Response**: Returns the updated user permission assignment

#### Remove Permission from User

```
DELETE /api/users/:userId/permissions/:permissionId
```

**Required Permission**: `user-permissions:delete`

**Response**: Status code 204 (No Content) if successful

### Permission Checks

Utility endpoints for checking permissions.

#### Check User Permission

```
GET /api/permissions/check/:resource/:action
```

**Query Parameters**:
- `userId`: ID of the user to check permission for (required if not checking current user)

**Response**:

```json
{
  "granted": true
}
```

#### Get Current User Permissions

```
GET /api/auth/me/permissions
```

**Response**:

```json
[
  {
    "resource": "users",
    "action": "create",
    "granted": true
  },
  {
    "resource": "users",
    "action": "read",
    "granted": true
  }
]
```

## Frontend Route Guard API

The Angular route guard uses the permission service to protect routes based on permission requirements specified in route data.

### Route Configuration Example

```typescript
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
      permissionRule: ['reports:view', 'reports:export'] // Any of these permissions
    }
  },
  {
    path: 'settings',
    component: SettingsComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: {
      permissionRule: { all: ['settings:view', 'settings:edit'] } // All permissions required
    }
  }
];
```

## Permission Service API

The Angular permission service provides methods for checking and managing permissions in the frontend application.

### Key Methods

#### Check Permission (Observable)

```typescript
permissionService.hasPermission('users', 'create')
  .subscribe(granted => {
    if (granted) {
      // Has permission
    }
  });
```

#### Check Permission (Synchronous)

```typescript
// Only works if permissions are already loaded
const hasPermission = permissionService.hasPermissionSync('users', 'create');
```

#### Check Multiple Permissions

```typescript
permissionService.hasPermissions([
  { resource: 'users', action: 'view' },
  { resource: 'roles', action: 'view' }
]).subscribe(hasAllPermissions => {
  if (hasAllPermissions) {
    // Has all permissions
  }
});
```

#### Load User Permissions

```typescript
permissionService.loadUserPermissions().subscribe(() => {
  // Permissions loaded
});
```

#### Clear Cache

```typescript
permissionService.clearCache();
```

## Dynamic Component API Endpoints

API endpoints for managing UI components, routes, and API endpoints in the dynamic permission system.

### UI Components

#### Get All UI Components

```
GET /api/permissions/components
```

**Required Permission**: `components:list`

**Query Parameters**:
- `search` (optional): Search term for filtering components
- `page` (optional): Page number for pagination
- `limit` (optional): Items per page

**Response**:

```json
{
  "items": [
    {
      "id": "create_user_btn",
      "description": "Create User Button",
      "selector": "app-create-user-button",
      "requiredPermissions": ["users:create"],
      "overridePermissions": false,
      "lastSynced": "2023-04-07T14:32:21Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10
}
```

#### Get UI Component by ID

```
GET /api/permissions/components/:id
```

**Required Permission**: `components:read`

**Response**:

```json
{
  "id": "create_user_btn",
  "description": "Create User Button",
  "selector": "app-create-user-button",
  "requiredPermissions": ["users:create"],
  "overridePermissions": false,
  "lastSynced": "2023-04-07T14:32:21Z",
  "permissions": [
    {
      "id": 5,
      "resource": "users",
      "action": "create",
      "description": "Create users"
    }
  ]
}
```

#### Update UI Component Permissions

```
PUT /api/permissions/components/:id/permissions
```

**Required Permission**: `components:update`

**Request Body**:

```json
{
  "requiredPermissions": ["users:create", "users:view"],
  "overridePermissions": true
}
```

**Response**: Returns the updated component with permissions

#### Reset UI Component to Default

```
POST /api/permissions/components/:id/reset
```

**Required Permission**: `components:manage`

**Response**: Returns the updated component with default permissions

### Frontend Routes

#### Get All Routes

```
GET /api/permissions/routes
```

**Required Permission**: `routes:list`

**Query Parameters**:
- `search` (optional): Search term for filtering routes
- `page` (optional): Page number for pagination
- `limit` (optional): Items per page

**Response**:

```json
{
  "items": [
    {
      "id": "admin_users_route",
      "path": "admin/users",
      "description": "User Management Page",
      "requiredPermissions": ["users:manage"],
      "overridePermissions": false,
      "lastSynced": "2023-04-07T14:32:21Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10
}
```

#### Get Route by ID

```
GET /api/permissions/routes/:id
```

**Required Permission**: `routes:read`

**Response**:

```json
{
  "id": "admin_users_route",
  "path": "admin/users",
  "description": "User Management Page",
  "requiredPermissions": ["users:manage"],
  "overridePermissions": false,
  "lastSynced": "2023-04-07T14:32:21Z",
  "permissions": [
    {
      "id": 10,
      "resource": "users",
      "action": "manage",
      "description": "Manage users"
    }
  ]
}
```

#### Update Route Permissions

```
PUT /api/permissions/routes/:id/permissions
```

**Required Permission**: `routes:update`

**Request Body**:

```json
{
  "requiredPermissions": ["users:manage", "admin:access"],
  "overridePermissions": true
}
```

**Response**: Returns the updated route with permissions

#### Reset Route to Default

```
POST /api/permissions/routes/:id/reset
```

**Required Permission**: `routes:manage`

**Response**: Returns the updated route with default permissions

### Synchronization

#### Get Sync Status

```
GET /api/permissions/sync/status
```

**Required Permission**: `permissions:sync:read`

**Response**:

```json
{
  "lastSync": "2023-04-07T14:32:21Z",
  "totalComponents": 42,
  "totalRoutes": 15,
  "totalEndpoints": 67,
  "pendingChanges": {
    "newComponents": 2,
    "updatedComponents": 1,
    "newRoutes": 0,
    "updatedRoutes": 3,
    "newEndpoints": 5,
    "updatedEndpoints": 0
  }
}
```

#### Start Sync Process

```
POST /api/permissions/sync
```

**Required Permission**: `permissions:sync:manage`

**Response**:

```json
{
  "success": true,
  "syncStarted": "2023-04-07T15:45:12Z",
  "jobId": "sync-job-12345",
  "estimatedCompletion": "2023-04-07T15:46:12Z"
}
```

#### Get Sync Log

```
GET /api/permissions/sync/log
```

**Required Permission**: `permissions:sync:read`

**Query Parameters**:
- `limit` (optional): Number of log entries to return
- `startDate` (optional): Start date for filtering logs

**Response**:

```json
{
  "logs": [
    {
      "timestamp": "2023-04-07T14:32:21Z",
      "type": "SYNC_STARTED",
      "message": "Permission sync process started"
    },
    {
      "timestamp": "2023-04-07T14:32:25Z",
      "type": "COMPONENT_ADDED",
      "message": "Added component 'create_user_btn'",
      "details": {
        "id": "create_user_btn",
        "permissions": ["users:create"]
      }
    },
    {
      "timestamp": "2023-04-07T14:33:01Z",
      "type": "SYNC_COMPLETED",
      "message": "Permission sync process completed",
      "details": {
        "addedComponents": 2,
        "updatedComponents": 1,
        "addedRoutes": 0,
        "updatedRoutes": 3,
        "addedEndpoints": 5,
        "updatedEndpoints": 0,
        "duration": "40s"
      }
    }
  ],
  "total": 3
}
``` 