# API Documentation

## Table of Contents
1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Users](#users)
4. [Groups](#groups)
5. [Roles](#roles)
6. [Tasks](#tasks)
7. [Error Handling](#error-handling)
8. [Pagination](#pagination)

## Overview

The API is a RESTful service that provides access to the application data. The base URL for all API endpoints is:

```
http://localhost:3000/api
```

All requests and responses are in JSON format. Timestamps are in ISO 8601 format.

### API Versioning

API versioning is handled via the URL path:

```
http://localhost:3000/api/v1/users
```

### Request Headers

All API requests should include the following headers:

```
Content-Type: application/json
Accept: application/json
```

## Authentication

Authentication is handled using JSON Web Tokens (JWT). 

### Register a New User

**Endpoint:** `POST /auth/register`

**Request:**
```json
{
  "email": "user@example.com",
  "password": "StrongP@ssw0rd",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response:** (201 Created)
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "createdAt": "2023-01-01T00:00:00Z"
}
```

### Login

**Endpoint:** `POST /auth/login`

**Request:**
```json
{
  "email": "user@example.com",
  "password": "StrongP@ssw0rd"
}
```

**Response:** (200 OK)
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": {
      "id": "uuid",
      "name": "Regular"
    }
  }
}
```

### Refresh Token

**Endpoint:** `POST /auth/refresh-token`

**Request:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:** (200 OK)
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
```

### Logout

**Endpoint:** `POST /auth/logout`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** (204 No Content)

### Get Current User

**Endpoint:** `GET /auth/me`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** (200 OK)
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": {
    "id": "uuid",
    "name": "Regular"
  },
  "createdAt": "2023-01-01T00:00:00Z",
  "lastLogin": "2023-01-02T00:00:00Z"
}
```

### Forgot Password

**Endpoint:** `POST /auth/forgot-password`

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response:** (200 OK)
```json
{
  "message": "If your email is registered, you will receive a password reset link."
}
```

### Reset Password

**Endpoint:** `POST /auth/reset-password`

**Request:**
```json
{
  "token": "reset-token",
  "password": "NewStrongP@ssw0rd"
}
```

**Response:** (200 OK)
```json
{
  "message": "Password has been reset successfully."
}
```

## Users

### Get All Users

**Endpoint:** `GET /users`

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Number of items per page (default: 10)
- `sort`: Sort field (default: "createdAt")
- `order`: Sort order ("asc" or "desc", default: "desc")
- `search`: Search term for name or email

**Response:** (200 OK)
```json
{
  "items": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": {
        "id": "uuid",
        "name": "Regular"
      },
      "createdAt": "2023-01-01T00:00:00Z"
    }
  ],
  "meta": {
    "totalItems": 100,
    "itemCount": 10,
    "itemsPerPage": 10,
    "totalPages": 10,
    "currentPage": 1
  }
}
```

### Get User by ID

**Endpoint:** `GET /users/:id`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** (200 OK)
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": {
    "id": "uuid",
    "name": "Regular"
  },
  "createdAt": "2023-01-01T00:00:00Z",
  "lastLogin": "2023-01-02T00:00:00Z",
  "groups": [
    {
      "id": "uuid",
      "name": "Marketing",
      "isAdmin": false
    }
  ]
}
```

### Update User

**Endpoint:** `PUT /users/:id`

**Headers:**
```
Authorization: Bearer <token>
```

**Request:**
```json
{
  "firstName": "Johnny",
  "lastName": "Doe",
  "email": "johnny.doe@example.com"
}
```

**Response:** (200 OK)
```json
{
  "id": "uuid",
  "email": "johnny.doe@example.com",
  "firstName": "Johnny",
  "lastName": "Doe",
  "updatedAt": "2023-01-03T00:00:00Z"
}
```

### Delete User

**Endpoint:** `DELETE /users/:id`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** (204 No Content)

### Change User Role

**Endpoint:** `PUT /users/:id/role`

**Headers:**
```
Authorization: Bearer <token>
```

**Request:**
```json
{
  "roleId": "uuid"
}
```

**Response:** (200 OK)
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": {
    "id": "uuid",
    "name": "Superuser"
  },
  "updatedAt": "2023-01-03T00:00:00Z"
}
```

## Groups

### Get All Groups

**Endpoint:** `GET /groups`

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Number of items per page (default: 10)
- `sort`: Sort field (default: "createdAt")
- `order`: Sort order ("asc" or "desc", default: "desc")
- `search`: Search term for group name

**Response:** (200 OK)
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Marketing",
      "description": "Marketing team group",
      "memberCount": 10,
      "createdAt": "2023-01-01T00:00:00Z"
    }
  ],
  "meta": {
    "totalItems": 20,
    "itemCount": 10,
    "itemsPerPage": 10,
    "totalPages": 2,
    "currentPage": 1
  }
}
```

### Create Group

**Endpoint:** `POST /groups`

**Headers:**
```
Authorization: Bearer <token>
```

**Request:**
```json
{
  "name": "Development",
  "description": "Development team group"
}
```

**Response:** (201 Created)
```json
{
  "id": "uuid",
  "name": "Development",
  "description": "Development team group",
  "createdAt": "2023-01-03T00:00:00Z"
}
```

### Get Group by ID

**Endpoint:** `GET /groups/:id`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** (200 OK)
```json
{
  "id": "uuid",
  "name": "Development",
  "description": "Development team group",
  "createdAt": "2023-01-03T00:00:00Z",
  "createdBy": {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe"
  },
  "members": [
    {
      "id": "uuid",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@example.com",
      "isAdmin": true,
      "joinedAt": "2023-01-03T00:00:00Z"
    }
  ]
}
```

### Update Group

**Endpoint:** `PUT /groups/:id`

**Headers:**
```
Authorization: Bearer <token>
```

**Request:**
```json
{
  "name": "Development Team",
  "description": "Development team group - updated"
}
```

**Response:** (200 OK)
```json
{
  "id": "uuid",
  "name": "Development Team",
  "description": "Development team group - updated",
  "updatedAt": "2023-01-04T00:00:00Z"
}
```

### Delete Group

**Endpoint:** `DELETE /groups/:id`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** (204 No Content)

### Add User to Group

**Endpoint:** `POST /groups/:id/users`

**Headers:**
```
Authorization: Bearer <token>
```

**Request:**
```json
{
  "userId": "uuid",
  "isAdmin": false
}
```

**Response:** (201 Created)
```json
{
  "userId": "uuid",
  "groupId": "uuid",
  "isAdmin": false,
  "joinedAt": "2023-01-04T00:00:00Z"
}
```

### Remove User from Group

**Endpoint:** `DELETE /groups/:id/users/:userId`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** (204 No Content)

### Update User Group Role

**Endpoint:** `PUT /groups/:id/users/:userId`

**Headers:**
```
Authorization: Bearer <token>
```

**Request:**
```json
{
  "isAdmin": true
}
```

**Response:** (200 OK)
```json
{
  "userId": "uuid",
  "groupId": "uuid",
  "isAdmin": true,
  "updatedAt": "2023-01-04T00:00:00Z"
}
```

## Roles

### Get All Roles

**Endpoint:** `GET /roles`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** (200 OK)
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Regular",
      "permissions": ["read:own", "write:own"]
    },
    {
      "id": "uuid",
      "name": "Superuser",
      "permissions": ["read:own", "write:own", "read:any"]
    },
    {
      "id": "uuid",
      "name": "Superadmin",
      "permissions": ["read:own", "write:own", "read:any", "write:any", "delete:any"]
    }
  ]
}
```

### Get Role by ID

**Endpoint:** `GET /roles/:id`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** (200 OK)
```json
{
  "id": "uuid",
  "name": "Superuser",
  "permissions": ["read:own", "write:own", "read:any"],
  "createdAt": "2023-01-01T00:00:00Z"
}
```

## Tasks

### Get All Tasks

**Endpoint:** `GET /tasks`

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Number of items per page (default: 10)
- `sort`: Sort field (default: "createdAt")
- `order`: Sort order ("asc" or "desc", default: "desc")
- `status`: Filter by status ("pending", "in-progress", "completed")

**Response:** (200 OK)
```json
{
  "items": [
    {
      "id": "uuid",
      "title": "Complete project documentation",
      "description": "Write detailed documentation for the project",
      "status": "in-progress",
      "dueDate": "2023-02-01T00:00:00Z",
      "assignedTo": {
        "id": "uuid",
        "firstName": "John",
        "lastName": "Doe"
      },
      "createdAt": "2023-01-01T00:00:00Z"
    }
  ],
  "meta": {
    "totalItems": 50,
    "itemCount": 10,
    "itemsPerPage": 10,
    "totalPages": 5,
    "currentPage": 1
  }
}
```

### Create Task

**Endpoint:** `POST /tasks`

**Headers:**
```
Authorization: Bearer <token>
```

**Request:**
```json
{
  "title": "Review pull request",
  "description": "Review the latest pull request for the frontend",
  "status": "pending",
  "dueDate": "2023-01-15T00:00:00Z",
  "assignedToId": "uuid"
}
```

**Response:** (201 Created)
```json
{
  "id": "uuid",
  "title": "Review pull request",
  "description": "Review the latest pull request for the frontend",
  "status": "pending",
  "dueDate": "2023-01-15T00:00:00Z",
  "assignedTo": {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe"
  },
  "createdBy": {
    "id": "uuid",
    "firstName": "Jane",
    "lastName": "Smith"
  },
  "createdAt": "2023-01-10T00:00:00Z"
}
```

### Get Task by ID

**Endpoint:** `GET /tasks/:id`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** (200 OK)
```json
{
  "id": "uuid",
  "title": "Review pull request",
  "description": "Review the latest pull request for the frontend",
  "status": "pending",
  "dueDate": "2023-01-15T00:00:00Z",
  "assignedTo": {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe"
  },
  "createdBy": {
    "id": "uuid",
    "firstName": "Jane",
    "lastName": "Smith"
  },
  "createdAt": "2023-01-10T00:00:00Z",
  "comments": [
    {
      "id": "uuid",
      "content": "I'll start working on this today",
      "createdBy": {
        "id": "uuid",
        "firstName": "John",
        "lastName": "Doe"
      },
      "createdAt": "2023-01-11T00:00:00Z"
    }
  ]
}
```

### Update Task

**Endpoint:** `PUT /tasks/:id`

**Headers:**
```
Authorization: Bearer <token>
```

**Request:**
```json
{
  "title": "Review pull request #123",
  "description": "Review the latest pull request for the frontend",
  "status": "in-progress",
  "dueDate": "2023-01-15T00:00:00Z"
}
```

**Response:** (200 OK)
```json
{
  "id": "uuid",
  "title": "Review pull request #123",
  "description": "Review the latest pull request for the frontend",
  "status": "in-progress",
  "dueDate": "2023-01-15T00:00:00Z",
  "updatedAt": "2023-01-11T00:00:00Z"
}
```

### Delete Task

**Endpoint:** `DELETE /tasks/:id`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** (204 No Content)

### Add Task Comment

**Endpoint:** `POST /tasks/:id/comments`

**Headers:**
```
Authorization: Bearer <token>
```

**Request:**
```json
{
  "content": "I've completed the review"
}
```

**Response:** (201 Created)
```json
{
  "id": "uuid",
  "content": "I've completed the review",
  "taskId": "uuid",
  "createdBy": {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe"
  },
  "createdAt": "2023-01-12T00:00:00Z"
}
```

## Error Handling

The API uses standard HTTP status codes to indicate the success or failure of a request.

### Common Error Codes

- `400 Bad Request`: The request was malformed or contained invalid parameters
- `401 Unauthorized`: Authentication is required or the provided credentials are invalid
- `403 Forbidden`: The authenticated user does not have permission to access the requested resource
- `404 Not Found`: The requested resource does not exist
- `409 Conflict`: The request conflicts with the current state of the server
- `422 Unprocessable Entity`: The request was well-formed but could not be processed due to semantic errors
- `500 Internal Server Error`: An unexpected error occurred on the server

### Error Response Format

```json
{
  "statusCode": 400,
  "message": "Invalid input",
  "errors": [
    {
      "field": "email",
      "message": "Email must be a valid email address"
    },
    {
      "field": "password",
      "message": "Password must be at least 8 characters long"
    }
  ]
}
```

## Pagination

Most list endpoints support pagination using the following query parameters:

- `page`: Page number (default: 1)
- `limit`: Number of items per page (default: 10)
- `sort`: Sort field (default depends on the endpoint)
- `order`: Sort order ("asc" or "desc", default: "desc")

### Pagination Response Format

```json
{
  "items": [
    // array of items
  ],
  "meta": {
    "totalItems": 100,
    "itemCount": 10,
    "itemsPerPage": 10,
    "totalPages": 10,
    "currentPage": 1
  },
  "links": {
    "first": "/api/users?page=1&limit=10",
    "previous": null,
    "next": "/api/users?page=2&limit=10",
    "last": "/api/users?page=10&limit=10"
  }
}
``` 