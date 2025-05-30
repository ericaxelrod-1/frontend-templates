## Permissions System

### Data Transfer Objects

The permissions system uses several DTOs to handle data transfer between the frontend and backend:

#### ApiEndpointDto
This DTO represents an API endpoint in the system and is used for endpoint permission management:
- `path`: The URL path of the endpoint
- `method`: The HTTP method (GET, POST, etc.)
- `description`: A human-readable description of the endpoint's purpose

The ApiEndpointDto is used in:
- Endpoint permission synchronization
- Listing available API endpoints
- Managing endpoint-specific permissions 

### Integration with Permissions System

The ApiEndpointDto plays a crucial role in the permissions system:

1. **Endpoint Scanning**
   - The `EndpointScannerService` scans the application for API endpoints
   - Converts discovered endpoints into ApiEndpointDto format
   - Used during permission synchronization to update endpoint metadata

2. **Permission Management**
   - Endpoints are associated with required permissions through the `requiredPermissions` field
   - The PermissionsService uses this information to:
     - Check user access to endpoints
     - Update endpoint permissions
     - Synchronize permissions with the cache system

3. **Frontend Integration**
   - The endpoint-permissions component displays endpoint information
   - Allows administrators to manage endpoint permissions
   - Provides filtering and search capabilities for endpoints

4. **Caching**
   - Endpoint information is cached for performance
   - The CacheEndpoint entity stores endpoint metadata
   - Permissions are synchronized between the database and cache

5. **API Access Control**
   - The system uses ApiEndpointDto information to:
     - Validate user permissions before endpoint access
     - Generate API documentation
     - Provide endpoint metadata for the frontend 