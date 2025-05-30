# API Documentation

This document provides comprehensive documentation for the API endpoints available in the Angular application with dynamic permissions.

## Table of Contents

1. [Authentication API](#authentication-api)
2. [Users API](#users-api)
3. [Roles API](#roles-api)
4. [Groups API](#groups-api)
5. [Permissions API](#permissions-api)
6. [Resources API](#resources-api)
7. [Actions API](#actions-api)
8. [Components API](#components-api)
9. [Routes API](#routes-api)
10. [Endpoints API](#endpoints-api)

## Base URL

All API endpoints are relative to the base URL:

```
http://localhost:3000/api
```

## Authentication API

### Login

Authenticates a user and returns a JWT token.

- **URL**: `/auth/login`
- **Method**: `POST`
- **Auth Required**: No
- **Permissions Required**: None

**Request Body**:
```json
{
  "username": "string",
  "password": "string"
}
```

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "accessToken": "string",
  "refreshToken": "string",
  "user": {
    "id": "number",
    "username": "string",
    "email": "string",
    "roles": [
      {
        "id": "number",
        "name": "string"
      }
    ]
  }
}
```

**Error Response**:
- **Code**: 401 Unauthorized
- **Content**:
```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "error": "Unauthorized"
}
```

### Register

Registers a new user.

- **URL**: `/auth/register`
- **Method**: `POST`
- **Auth Required**: No
- **Permissions Required**: None

**Request Body**:
```json
{
  "username": "string",
  "email": "string",
  "password": "string"
}
```

**Success Response**:
- **Code**: 201 Created
- **Content**:
```json
{
  "id": "number",
  "username": "string",
  "email": "string"
}
```

**Error Response**:
- **Code**: 400 Bad Request
- **Content**:
```json
{
  "statusCode": 400,
  "message": ["Username already exists"],
  "error": "Bad Request"
}
```

### Refresh Token

Refreshes the JWT token.

- **URL**: `/auth/refresh`
- **Method**: `POST`
- **Auth Required**: No
- **Permissions Required**: None

**Request Body**:
```json
{
  "refreshToken": "string"
}
```

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "accessToken": "string",
  "refreshToken": "string"
}
```

**Error Response**:
- **Code**: 401 Unauthorized
- **Content**:
```json
{
  "statusCode": 401,
  "message": "Invalid refresh token",
  "error": "Unauthorized"
}
```

### Logout

Logs out the current user.

- **URL**: `/auth/logout`
- **Method**: `POST`
- **Auth Required**: Yes
- **Permissions Required**: None

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "message": "Logged out successfully"
}
```

For more information about authentication implementation, see the [Security Architecture section](ARCHITECTURE.md#security-architecture) in the Architecture Documentation.

## Users API

### Get All Users

Retrieves a list of all users.

- **URL**: `/users`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `users:list`

**Query Parameters**:
- `page` (optional): Page number (default: 1)
- `limit` (optional): Number of items per page (default: 10)
- `search` (optional): Search term for username or email

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "items": [
    {
      "id": "number",
      "username": "string",
      "email": "string",
      "roles": [
        {
          "id": "number",
          "name": "string"
        }
      ],
      "groups": [
        {
          "id": "number",
          "name": "string"
        }
      ]
    }
  ],
  "meta": {
    "totalItems": "number",
    "itemCount": "number",
    "itemsPerPage": "number",
    "totalPages": "number",
    "currentPage": "number"
  }
}
```

### Get User by ID

Retrieves a specific user by ID.

- **URL**: `/users/:id`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `users:read` or `users:manage`

**URL Parameters**:
- `id`: User ID

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "number",
  "username": "string",
  "email": "string",
  "roles": [
    {
      "id": "number",
      "name": "string"
    }
  ],
  "groups": [
    {
      "id": "number",
      "name": "string"
    }
  ]
}
```

**Error Response**:
- **Code**: 404 Not Found
- **Content**:
```json
{
  "statusCode": 404,
  "message": "User not found",
  "error": "Not Found"
}
```

### Create User

Creates a new user.

- **URL**: `/users`
- **Method**: `POST`
- **Auth Required**: Yes
- **Permissions Required**: `users:create`

**Request Body**:
```json
{
  "username": "string",
  "email": "string",
  "password": "string",
  "roleIds": ["number"],
  "groupIds": ["number"]
}
```

**Success Response**:
- **Code**: 201 Created
- **Content**:
```json
{
  "id": "number",
  "username": "string",
  "email": "string",
  "roles": [
    {
      "id": "number",
      "name": "string"
    }
  ],
  "groups": [
    {
      "id": "number",
      "name": "string"
    }
  ]
}
```

### Update User

Updates an existing user.

- **URL**: `/users/:id`
- **Method**: `PUT`
- **Auth Required**: Yes
- **Permissions Required**: `users:update`

**URL Parameters**:
- `id`: User ID

**Request Body**:
```json
{
  "username": "string",
  "email": "string",
  "password": "string",
  "roleIds": ["number"],
  "groupIds": ["number"]
}
```

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "number",
  "username": "string",
  "email": "string",
  "roles": [
    {
      "id": "number",
      "name": "string"
    }
  ],
  "groups": [
    {
      "id": "number",
      "name": "string"
    }
  ]
}
```

### Delete User

Deletes a user.

- **URL**: `/users/:id`
- **Method**: `DELETE`
- **Auth Required**: Yes
- **Permissions Required**: `users:delete`

**URL Parameters**:
- `id`: User ID

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "message": "User deleted successfully"
}
```

## Roles API

### Get All Roles

Retrieves a list of all roles.

- **URL**: `/roles`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `roles:list`

**Query Parameters**:
- `page` (optional): Page number (default: 1)
- `limit` (optional): Number of items per page (default: 10)
- `search` (optional): Search term for role name

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "items": [
    {
      "id": "number",
      "name": "string",
      "description": "string",
      "permissions": [
        {
          "id": "number",
          "resource": {
            "id": "number",
            "name": "string"
          },
          "action": {
            "id": "number",
            "name": "string"
          },
          "granted": "boolean"
        }
      ]
    }
  ],
  "meta": {
    "totalItems": "number",
    "itemCount": "number",
    "itemsPerPage": "number",
    "totalPages": "number",
    "currentPage": "number"
  }
}
```

### Get Role by ID

Retrieves a specific role by ID.

- **URL**: `/roles/:id`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `roles:read` or `roles:manage`

**URL Parameters**:
- `id`: Role ID

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "number",
  "name": "string",
  "description": "string",
  "permissions": [
    {
      "id": "number",
      "resource": {
        "id": "number",
        "name": "string"
      },
      "action": {
        "id": "number",
        "name": "string"
      },
      "granted": "boolean"
    }
  ]
}
```

### Create Role

Creates a new role.

- **URL**: `/roles`
- **Method**: `POST`
- **Auth Required**: Yes
- **Permissions Required**: `roles:create`

**Request Body**:
```json
{
  "name": "string",
  "description": "string",
  "permissionIds": ["number"]
}
```

**Success Response**:
- **Code**: 201 Created
- **Content**:
```json
{
  "id": "number",
  "name": "string",
  "description": "string",
  "permissions": [
    {
      "id": "number",
      "resource": {
        "id": "number",
        "name": "string"
      },
      "action": {
        "id": "number",
        "name": "string"
      },
      "granted": "boolean"
    }
  ]
}
```

### Update Role

Updates an existing role.

- **URL**: `/roles/:id`
- **Method**: `PUT`
- **Auth Required**: Yes
- **Permissions Required**: `roles:update`

**URL Parameters**:
- `id`: Role ID

**Request Body**:
```json
{
  "name": "string",
  "description": "string",
  "permissionIds": ["number"]
}
```

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "number",
  "name": "string",
  "description": "string",
  "permissions": [
    {
      "id": "number",
      "resource": {
        "id": "number",
        "name": "string"
      },
      "action": {
        "id": "number",
        "name": "string"
      },
      "granted": "boolean"
    }
  ]
}
```

### Delete Role

Deletes a role.

- **URL**: `/roles/:id`
- **Method**: `DELETE`
- **Auth Required**: Yes
- **Permissions Required**: `roles:delete`

**URL Parameters**:
- `id`: Role ID

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "message": "Role deleted successfully"
}
```

For more information about roles and permissions, see the [Permissions Documentation](PERMISSIONS.md).

## Permissions API

### Get All Permissions

Retrieves a list of all permissions.

- **URL**: `/permissions`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `permissions:list`

**Query Parameters**:
- `page` (optional): Page number (default: 1)
- `limit` (optional): Number of items per page (default: 10)
- `search` (optional): Search term for permission name

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "items": [
    {
      "id": "number",
      "resource": {
        "id": "number",
        "name": "string"
      },
      "action": {
        "id": "number",
        "name": "string"
      },
      "description": "string"
    }
  ],
  "meta": {
    "totalItems": "number",
    "itemCount": "number",
    "itemsPerPage": "number",
    "totalPages": "number",
    "currentPage": "number"
  }
}
```

### Get Permission by ID

Retrieves a specific permission by ID.

- **URL**: `/permissions/:id`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `permissions:read` or `permissions:manage`

**URL Parameters**:
- `id`: Permission ID

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "number",
  "resource": {
    "id": "number",
    "name": "string"
  },
  "action": {
    "id": "number",
    "name": "string"
  },
  "description": "string"
}
```

### Create Permission

Creates a new permission.

- **URL**: `/permissions`
- **Method**: `POST`
- **Auth Required**: Yes
- **Permissions Required**: `permissions:create`

**Request Body**:
```json
{
  "resourceId": "number",
  "actionId": "number",
  "description": "string"
}
```

**Success Response**:
- **Code**: 201 Created
- **Content**:
```json
{
  "id": "number",
  "resource": {
    "id": "number",
    "name": "string"
  },
  "action": {
    "id": "number",
    "name": "string"
  },
  "description": "string"
}
```

### Update Permission

Updates an existing permission.

- **URL**: `/permissions/:id`
- **Method**: `PUT`
- **Auth Required**: Yes
- **Permissions Required**: `permissions:update`

**URL Parameters**:
- `id`: Permission ID

**Request Body**:
```json
{
  "resourceId": "number",
  "actionId": "number",
  "description": "string"
}
```

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "number",
  "resource": {
    "id": "number",
    "name": "string"
  },
  "action": {
    "id": "number",
    "name": "string"
  },
  "description": "string"
}
```

### Delete Permission

Deletes a permission.

- **URL**: `/permissions/:id`
- **Method**: `DELETE`
- **Auth Required**: Yes
- **Permissions Required**: `permissions:delete`

**URL Parameters**:
- `id`: Permission ID

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "message": "Permission deleted successfully"
}
```

### Check User Permission

Checks if a user has a specific permission.

- **URL**: `/permissions/check/:resource/:action`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `permissions:check`

**URL Parameters**:
- `resource`: Resource name
- `action`: Action name

**Query Parameters**:
- `userId` (optional): User ID (defaults to current user)

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "hasPermission": "boolean"
}
```

For more information about working with permissions, see the [Working with Permissions section](DEVELOPMENT.md#working-with-permissions) in the Development Guide.

## Resources API

### Get All Resources

Retrieves a list of all resources.

- **URL**: `/resources`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `resources:list`

**Query Parameters**:
- `page` (optional): Page number (default: 1)
- `limit` (optional): Number of items per page (default: 10)
- `search` (optional): Search term for resource name

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "items": [
    {
      "id": "number",
      "name": "string",
      "description": "string"
    }
  ],
  "meta": {
    "totalItems": "number",
    "itemCount": "number",
    "itemsPerPage": "number",
    "totalPages": "number",
    "currentPage": "number"
  }
}
```

### Get Resource by ID

Retrieves a specific resource by ID.

- **URL**: `/resources/:id`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `resources:read` or `resources:manage`

**URL Parameters**:
- `id`: Resource ID

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "number",
  "name": "string",
  "description": "string"
}
```

### Create Resource

Creates a new resource.

- **URL**: `/resources`
- **Method**: `POST`
- **Auth Required**: Yes
- **Permissions Required**: `resources:create`

**Request Body**:
```json
{
  "name": "string",
  "description": "string"
}
```

**Success Response**:
- **Code**: 201 Created
- **Content**:
```json
{
  "id": "number",
  "name": "string",
  "description": "string"
}
```

### Update Resource

Updates an existing resource.

- **URL**: `/resources/:id`
- **Method**: `PUT`
- **Auth Required**: Yes
- **Permissions Required**: `resources:update`

**URL Parameters**:
- `id`: Resource ID

**Request Body**:
```json
{
  "name": "string",
  "description": "string"
}
```

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "number",
  "name": "string",
  "description": "string"
}
```

### Delete Resource

Deletes a resource.

- **URL**: `/resources/:id`
- **Method**: `DELETE`
- **Auth Required**: Yes
- **Permissions Required**: `resources:delete`

**URL Parameters**:
- `id`: Resource ID

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "message": "Resource deleted successfully"
}
```

## Actions API

### Get All Actions

Retrieves a list of all actions.

- **URL**: `/actions`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `actions:list`

**Query Parameters**:
- `page` (optional): Page number (default: 1)
- `limit` (optional): Number of items per page (default: 10)
- `search` (optional): Search term for action name

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "items": [
    {
      "id": "number",
      "name": "string",
      "description": "string"
    }
  ],
  "meta": {
    "totalItems": "number",
    "itemCount": "number",
    "itemsPerPage": "number",
    "totalPages": "number",
    "currentPage": "number"
  }
}
```

### Get Action by ID

Retrieves a specific action by ID.

- **URL**: `/actions/:id`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `actions:read` or `actions:manage`

**URL Parameters**:
- `id`: Action ID

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "number",
  "name": "string",
  "description": "string"
}
```

### Create Action

Creates a new action.

- **URL**: `/actions`
- **Method**: `POST`
- **Auth Required**: Yes
- **Permissions Required**: `actions:create`

**Request Body**:
```json
{
  "name": "string",
  "description": "string"
}
```

**Success Response**:
- **Code**: 201 Created
- **Content**:
```json
{
  "id": "number",
  "name": "string",
  "description": "string"
}
```

### Update Action

Updates an existing action.

- **URL**: `/actions/:id`
- **Method**: `PUT`
- **Auth Required**: Yes
- **Permissions Required**: `actions:update`

**URL Parameters**:
- `id`: Action ID

**Request Body**:
```json
{
  "name": "string",
  "description": "string"
}
```

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "number",
  "name": "string",
  "description": "string"
}
```

### Delete Action

Deletes an action.

- **URL**: `/actions/:id`
- **Method**: `DELETE`
- **Auth Required**: Yes
- **Permissions Required**: `actions:delete`

**URL Parameters**:
- `id`: Action ID

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "message": "Action deleted successfully"
}
```

## Components API

### Get All Components

Retrieves a list of all UI components.

- **URL**: `/components`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `components:list`

**Query Parameters**:
- `page` (optional): Page number (default: 1)
- `limit` (optional): Number of items per page (default: 10)
- `search` (optional): Search term for component ID or description

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "items": [
    {
      "id": "string",
      "description": "string",
      "requiredPermissions": ["string"]
    }
  ],
  "meta": {
    "totalItems": "number",
    "itemCount": "number",
    "itemsPerPage": "number",
    "totalPages": "number",
    "currentPage": "number"
  }
}
```

### Get Component by ID

Retrieves a specific UI component by ID.

- **URL**: `/components/:id`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `components:read` or `components:manage`

**URL Parameters**:
- `id`: Component ID

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "string",
  "description": "string",
  "requiredPermissions": ["string"]
}
```

### Update Component

Updates an existing UI component.

- **URL**: `/components/:id`
- **Method**: `PUT`
- **Auth Required**: Yes
- **Permissions Required**: `components:update`

**URL Parameters**:
- `id`: Component ID

**Request Body**:
```json
{
  "description": "string",
  "requiredPermissions": ["string"]
}
```

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "string",
  "description": "string",
  "requiredPermissions": ["string"]
}
```

### Scan Components

Scans the application for UI components with permission requirements.

- **URL**: `/components/scan`
- **Method**: `POST`
- **Auth Required**: Yes
- **Permissions Required**: `components:scan`

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "scanned": "number",
  "added": "number",
  "updated": "number",
  "unchanged": "number"
}
```

For more information about component registration, see the [Dynamic Component Registration section](PERMISSIONS.md#dynamic-component-registration) in the Permissions Documentation.

## Routes API

### Get All Routes

Retrieves a list of all frontend routes.

- **URL**: `/routes`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `routes:list`

**Query Parameters**:
- `page` (optional): Page number (default: 1)
- `limit` (optional): Number of items per page (default: 10)
- `search` (optional): Search term for route path or description

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "items": [
    {
      "id": "string",
      "path": "string",
      "description": "string",
      "requiredPermissions": ["string"]
    }
  ],
  "meta": {
    "totalItems": "number",
    "itemCount": "number",
    "itemsPerPage": "number",
    "totalPages": "number",
    "currentPage": "number"
  }
}
```

### Get Route by ID

Retrieves a specific frontend route by ID.

- **URL**: `/routes/:id`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `routes:read` or `routes:manage`

**URL Parameters**:
- `id`: Route ID

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "string",
  "path": "string",
  "description": "string",
  "requiredPermissions": ["string"]
}
```

### Update Route

Updates an existing frontend route.

- **URL**: `/routes/:id`
- **Method**: `PUT`
- **Auth Required**: Yes
- **Permissions Required**: `routes:update`

**URL Parameters**:
- `id`: Route ID

**Request Body**:
```json
{
  "description": "string",
  "requiredPermissions": ["string"]
}
```

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "string",
  "path": "string",
  "description": "string",
  "requiredPermissions": ["string"]
}
```

### Scan Routes

Scans the application for frontend routes with permission requirements.

- **URL**: `/routes/scan`
- **Method**: `POST`
- **Auth Required**: Yes
- **Permissions Required**: `routes:scan`

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "scanned": "number",
  "added": "number",
  "updated": "number",
  "unchanged": "number"
}
```

## Endpoints API

### Get All Endpoints

Retrieves a list of all API endpoints.

- **URL**: `/endpoints`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `endpoints:list`

**Query Parameters**:
- `page` (optional): Page number (default: 1)
- `limit` (optional): Number of items per page (default: 10)
- `search` (optional): Search term for endpoint path or description

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "items": [
    {
      "id": "string",
      "path": "string",
      "method": "string",
      "description": "string",
      "requiredPermissions": ["string"]
    }
  ],
  "meta": {
    "totalItems": "number",
    "itemCount": "number",
    "itemsPerPage": "number",
    "totalPages": "number",
    "currentPage": "number"
  }
}
```

### Get Endpoint by ID

Retrieves a specific API endpoint by ID.

- **URL**: `/endpoints/:id`
- **Method**: `GET`
- **Auth Required**: Yes
- **Permissions Required**: `endpoints:read` or `endpoints:manage`

**URL Parameters**:
- `id`: Endpoint ID

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "string",
  "path": "string",
  "method": "string",
  "description": "string",
  "requiredPermissions": ["string"]
}
```

### Update Endpoint

Updates an existing API endpoint.

- **URL**: `/endpoints/:id`
- **Method**: `PUT`
- **Auth Required**: Yes
- **Permissions Required**: `endpoints:update`

**URL Parameters**:
- `id`: Endpoint ID

**Request Body**:
```json
{
  "description": "string",
  "requiredPermissions": ["string"]
}
```

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "id": "string",
  "path": "string",
  "method": "string",
  "description": "string",
  "requiredPermissions": ["string"]
}
```

### Scan Endpoints

Scans the application for API endpoints with permission requirements.

- **URL**: `/endpoints/scan`
- **Method**: `POST`
- **Auth Required**: Yes
- **Permissions Required**: `endpoints:scan`

**Success Response**:
- **Code**: 200 OK
- **Content**:
```json
{
  "scanned": "number",
  "added": "number",
  "updated": "number",
  "unchanged": "number"
}
```

## Error Responses

### Common Error Responses

#### 400 Bad Request

Returned when the request is malformed or contains invalid data.

```json
{
  "statusCode": 400,
  "message": ["Error message"],
  "error": "Bad Request"
}
```

#### 401 Unauthorized

Returned when authentication is required but not provided or is invalid.

```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

#### 403 Forbidden

Returned when the authenticated user does not have the required permissions.

```json
{
  "statusCode": 403,
  "message": "Forbidden",
  "error": "Forbidden"
}
```

#### 404 Not Found

Returned when the requested resource does not exist.

```json
{
  "statusCode": 404,
  "message": "Resource not found",
  "error": "Not Found"
}
```

#### 500 Internal Server Error

Returned when an unexpected error occurs on the server.

```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Internal Server Error"
}
```

For more information about error handling and debugging, see the [Debugging and Logging section](DEVELOPMENT.md#debugging-and-logging) in the Development Guide.
