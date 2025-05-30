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

## ApiEndpointDto Integration

The `ApiEndpointDto` is a core component of the permissions system that represents API endpoints and their metadata. It facilitates:

1. **Endpoint Discovery and Registration**
   - The `EndpointScannerService` scans the application to discover API endpoints
   - Each endpoint is converted to an `ApiEndpointDto` containing:
     - `path`: The URL path of the endpoint
     - `method`: HTTP method (GET, POST, etc.)
     - `description`: Human-readable description
   - Endpoints are stored in the `api_endpoints` table

2. **Permission Management**
   - Each endpoint can have required permissions
   - Permissions are stored in the `api_endpoint_permissions` join table
   - The `PermissionsService` provides methods to:
     - Update endpoint permissions
     - Check user access to endpoints
     - Parse permission strings into Permission entities

3. **Caching System**
   - Endpoint metadata is cached in the `cache_endpoints` table
   - The `CacheSyncService` maintains synchronization between:
     - In-memory endpoint definitions
     - Database records
     - Cache entries
   - Cache includes:
     - Endpoint metadata
     - Required permissions
     - Last sync timestamp

4. **Controller Integration**
   - The `PermissionsController` exposes endpoints for:
     - Listing all endpoints (`GET /permissions/endpoints`)
     - Getting endpoint by ID (`GET /permissions/endpoints/:id`)
     - Updating permissions (`PATCH /permissions/endpoints/:id`)
     - Testing access (`GET /permissions/endpoint-access-test/:id`)

5. **Database Schema**
   ```sql
   CREATE TABLE "api_endpoints" (
       "id" varchar PRIMARY KEY NOT NULL,
       "method" varchar NOT NULL,
       "path" varchar NOT NULL,
       "description" varchar,
       "controllerName" varchar,
       "handlerName" varchar,
       "overridePermissions" boolean NOT NULL DEFAULT (0),
       "lastSynced" datetime,
       "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
       "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
   )
   ```

6. **Usage in Code**
   ```typescript
   // Scanning endpoints
   const endpoints = await endpointScannerService.scanEndpoints();
   
   // Updating permissions
   await permissionsService.updateEndpointPermissions(
     endpointId,
     ['users:read', 'users:write'],
     false
   );
   
   // Checking access
   const hasAccess = await permissionsService.canUserAccessEndpoint(
     userId,
     endpointId,
     'GET'
   );
   ```

7. **Frontend Integration**
   - The frontend uses endpoint metadata for:
     - Displaying available endpoints
     - Managing endpoint permissions
     - Testing endpoint access
     - Generating API documentation

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