# STORY-001: Backend Server-Side Pagination & Sorting

## Objective
Implement capabilities in the backend `RolesService` and `RolesController` to support server-side pagination, sorting, and searching for the `/roles` endpoint.

## Value Proposition
This enables the frontend to fetch only the data it needs for display, considerably resolving performance bottlenecks associated with loading large sets of roles. 

## Requirements
- `RolesController.findAll` must accept `page`, `pageSize`, `sortBy`, `sortDirection`, and `search` query parameters.
- `RolesService.findAll` must use `findAndCount` on `this.rolesRepository`, filtering using `ILike` against the name and description for the provided `search` term.
- `RolesService.findAll` must apply `order`, `skip`, and `take` correctly and return the `items`, `total`, `page`, and `pageSize`.
- Ensure mapped `Role` permissions are successfully included in the returned structural object, using the `transformRoleForFrontend` helper method if required to strip out intermediate `rolePermissions`.

## Implementation Tasks
The tasks to sequentially execute:
1. `TASK-001-update-roles-service.md`
2. `TASK-002-update-roles-controller.md`
3. `TASK-003-verify-backend.md`
