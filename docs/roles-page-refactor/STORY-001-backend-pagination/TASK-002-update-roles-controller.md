# TASK-002: Update RolesController to Support Pagination/Sorting

## Objective
Update the `findAll` method in `RolesController` to capture query parameters and pass them downstream to `RolesService`.

## Current State
`RolesController.findAll` currently expects no parameters and returns `Promise<Role[]>`.

## Desired State
`findAll` should capture `@Query` parameters `page`, `pageSize`, `sortBy`, `sortDirection`, and `search`, mapping them to the newly updated `RolesService.findAll` method signature. It should return the paginated wrapper structure.

## Steps
1. Add `@Query` to the imports from `@nestjs/common`.
2. Modify the `findAll` signature:
   ```typescript
   findAll(
     @Query('page') page?: number,
     @Query('pageSize') pageSize?: number,
     @Query('sortBy') sortBy?: string,
     @Query('sortDirection') sortDirection?: 'asc' | 'desc',
     @Query('search') search?: string,
   ): Promise<{ items: Role[]; total: number; page: number; pageSize: number }>
   ```
3. Pass the parsed values to `this.rolesService.findAll(...)`, defaulting `page` to `0`, `pageSize` to `10`, etc.
   ```typescript
   return this.rolesService.findAll(
     page ? +page : 0,
     pageSize ? +pageSize : 10,
     sortBy || 'name',
     (sortDirection?.toUpperCase() as 'ASC' | 'DESC') || 'ASC',
     search || '',
   );
   ```
4. Update the corresponding Swagger `@ApiResponse` decorator to reflect a paginated list rather than `type: [Role]`.
