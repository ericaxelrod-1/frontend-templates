# TASK-001: Update RolesService to Support Pagination/Sorting

## Objective
Update the `findAll` method in `RolesService` to accept pagination, sorting, and searching parameters, and to return a paginated response using `findAndCount`.

## Current State
`RolesService.findAll` currently takes no arguments and returns all roles using `rolesRepository.find({ relations: ['rolePermissions', 'rolePermissions.permission'] })`. It then loops through these roles to strip out `rolePermissions` and return mapped permissions.

## Desired State
`findAll` should accept standard server-side parameters and return a generic `ServerResponse` structure: `{ items: Role[], total: number, page: number, pageSize: number }`.

## Steps
1. Modify the `findAll` signature:
   ```typescript
   async findAll(
     page = 0,
     pageSize = 10,
     sortBy = 'name',
     sortDirection: 'ASC' | 'DESC' = 'ASC',
     search = '',
   ): Promise<{ items: Role[]; total: number; page: number; pageSize: number }>
   ```
2. Calculate `skip` and `take`:
   ```typescript
   const skip = page * pageSize;
   const take = pageSize;
   ```
3. Use `findAndCount` to execute the query, applying a `Where` clause for the `search` term against `name` and `description` if `search` is provided. Use TypeORM's `ILike`.
   Include the necessary relations as currently implemented.
4. Call `this.transformRoleForFrontend(role)` on the returned `items` array.
5. Return the object with `{ items: transformedItems, total, page, pageSize }`.
