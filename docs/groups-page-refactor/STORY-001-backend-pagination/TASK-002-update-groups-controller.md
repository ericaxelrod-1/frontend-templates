# TASK-002: Update GroupsController findAll

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-002 |
| **Status** | Open |
| **Story** | STORY-001: Implement Backend Server-Side Pagination & Sorting |
| **Description** | Update the `findAll` method in `GroupsController` to intercept query arguments and pass them to the service. |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | TASK-001 |

---

## Instructions

### Step 1: Extract Query strings in the Controller

Open `angular/backend/src/modules/users/groups.controller.ts`.

Inject `@Query()` decorators into the `findAll()` method to accept `page`, `pageSize`, `sortBy`, `sortDirection`, and `search`. Make sure to parse numbers correctly (e.g. `parseInt(page) || 0`).

```typescript
findAll(
  @Query('page') page?: number,
  @Query('pageSize') pageSize?: number,
  @Query('sortBy') sortBy?: string,
  @Query('sortDirection') sortDirection?: 'asc' | 'desc',
  @Query('search') search?: string,
) {
```

### Step 2: Delegate variables to service

Update the underlying `this.groupsService.findAll(...)` call within the controller to pass these parameters directly.

Update the method return type definition to ensure Swagger decorators reflect an object, not an array.

---

## Acceptance Criteria

- [ ] The `findAll` method extracts `page`, `pageSize`, `sortBy`, `sortDirection`, and `search` using `@Query()`.
- [ ] Default fallback values are handled if omitted from the URL.
- [ ] API routes pass all parameters down to the `GroupsService`.
