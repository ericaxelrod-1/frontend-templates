# API Endpoints Documentation

## Swagger Integration

This project uses Swagger (OpenAPI) for API documentation. Swagger is integrated using the `@nestjs/swagger` package and provides:

- Interactive API documentation
- API testing interface
- OpenAPI specification
- Request/response schema validation

### Accessing Swagger UI
- Development: http://localhost:3000/api
- Documentation includes:
  - Endpoint descriptions
  - Request/response schemas
  - Authentication requirements
  - Example requests/responses

### Swagger Decorators Used
- `@ApiTags`: Groups endpoints by feature
- `@ApiOperation`: Describes endpoint purpose
- `@ApiResponse`: Documents possible responses
- `@ApiBearerAuth`: Indicates JWT authentication requirement
- `@ApiProperty`: Documents DTO properties

## Endpoints

### Roles API

#### GET /roles
- **Purpose**: Retrieve all roles
- **Authentication**: JWT required
- **Inputs**: None
- **Expected Output**:
  ```typescript
  Role[]
  ```
- **Response Codes**:
  - 200: Success
  - 401: Unauthorized

#### GET /roles/:id
- **Purpose**: Retrieve specific role
- **Authentication**: JWT required
- **Inputs**: 
  - Path parameter: `id` (number)
- **Expected Output**:
  ```typescript
  Role
  ```
- **Response Codes**:
  - 200: Success
  - 401: Unauthorized
  - 404: Role not found

#### PUT /roles/:id/permissions
- **Purpose**: Update role permissions
- **Authentication**: JWT required (Superadmin only)
- **Inputs**:
  - Path parameter: `id` (number)
  - Body:
    ```typescript
    {
      permissions: {
        canCreateUsers?: boolean;
        canDeleteUsers?: boolean;
        canEditUsers?: boolean;
        canViewAllUsers?: boolean;
        canEmulateUsers?: boolean;
        canManageGroups?: boolean;
        canManageRoles?: boolean;
      }
    }
    ```
- **Expected Output**:
  ```typescript
  Role
  ```
- **Response Codes**:
  - 200: Success
  - 401: Unauthorized
  - 403: Forbidden
  - 404: Role not found

#### PUT /roles/users/:userId/role
- **Purpose**: Assign role to user
- **Authentication**: JWT required (with canManageRoles permission)
- **Inputs**:
  - Path parameter: `userId` (number)
  - Body:
    ```typescript
    {
      roleId: number
    }
    ```
- **Expected Output**:
  ```typescript
  User
  ```
- **Response Codes**:
  - 200: Success
  - 401: Unauthorized
  - 403: Forbidden
  - 404: User or role not found

### Groups API

#### POST /groups
- **Purpose**: Create new group
- **Authentication**: JWT required (with canManageGroups permission)
- **Inputs**:
  ```typescript
  {
    name: string;
    description?: string;
  }
  ```
- **Expected Output**:
  ```typescript
  Group
  ```
- **Response Codes**:
  - 201: Created
  - 401: Unauthorized
  - 403: Forbidden

#### GET /groups
- **Purpose**: Retrieve accessible groups
- **Authentication**: JWT required
- **Inputs**: None
- **Expected Output**:
  ```typescript
  Group[]
  ```
- **Response Codes**:
  - 200: Success
  - 401: Unauthorized

#### GET /groups/:id
- **Purpose**: Retrieve specific group
- **Authentication**: JWT required
- **Inputs**:
  - Path parameter: `id` (number)
- **Expected Output**:
  ```typescript
  Group
  ```
- **Response Codes**:
  - 200: Success
  - 401: Unauthorized
  - 403: Forbidden
  - 404: Group not found

#### POST /groups/:id/members/:userId
- **Purpose**: Add member to group
- **Authentication**: JWT required
- **Inputs**:
  - Path parameters: 
    - `id` (number)
    - `userId` (number)
- **Expected Output**:
  ```typescript
  UserGroup
  ```
- **Response Codes**:
  - 201: Created
  - 400: User already in group
  - 401: Unauthorized
  - 403: Forbidden
  - 404: Group or user not found

#### DELETE /groups/:id/members/:userId
- **Purpose**: Remove member from group
- **Authentication**: JWT required
- **Inputs**:
  - Path parameters:
    - `id` (number)
    - `userId` (number)
- **Expected Output**: None
- **Response Codes**:
  - 200: Success
  - 401: Unauthorized
  - 403: Forbidden
  - 404: Group, user, or membership not found

#### DELETE /groups/:id
- **Purpose**: Delete group
- **Authentication**: JWT required
- **Inputs**:
  - Path parameter: `id` (number)
- **Expected Output**: None
- **Response Codes**:
  - 200: Success
  - 401: Unauthorized
  - 403: Forbidden
  - 404: Group not found

### Known Error Responses

All endpoints may return these common errors:
- **401 Unauthorized**:
  ```json
  {
    "statusCode": 401,
    "message": "Unauthorized"
  }
  ```
- **403 Forbidden**:
  ```json
  {
    "statusCode": 403,
    "message": "Insufficient permissions"
  }
  ```
- **404 Not Found**:
  ```json
  {
    "statusCode": 404,
    "message": "Resource not found"
  }
  ```
- **400 Bad Request**:
  ```json
  {
    "statusCode": 400,
    "message": "Validation failed",
    "errors": [...]
  }
  ``` 