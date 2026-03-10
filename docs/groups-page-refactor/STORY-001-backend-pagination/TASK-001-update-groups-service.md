# TASK-001: Update GroupsService findAll

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-001 |
| **Status** | Open |
| **Story** | STORY-001: Implement Backend Server-Side Pagination & Sorting |
| **Description** | Update the `findAll` method in `GroupsService` to support TypeORM query options for pagination, sorting, and searching. |
| **Estimated Effort** | 15 minutes |
| **Dependencies** | None |

---

## Instructions

### Step 1: Update the method signature in `GroupsService`

Open `angular/backend/src/modules/users/groups.service.ts`.

Change the `findAll` signature to accept an optional options object for pagination, sorting, and searching. Use explicit parameters or a generic interface to cleanly handle:

- `page`: default 0
- `pageSize`: default 10
- `sortBy`: default 'name'
- `sortDirection`: default 'asc'
- `search`: default empty

It should return `{ items: Group[], total: number, page: number, pageSize: number }`.

### Step 2: Implement query parsing and TypeORM execution

Update `findAll` to calculate the `skip` value (`page * pageSize`) and `take` value (`pageSize`).

Construct a `FindManyOptions<Group>` that includes:
- `where`: Use `ILike` against `name` and `description` if `search` is provided (joined with `OR` operations).
- `order`: `[sortBy]: sortDirection.toUpperCase()`.
- `skip`: computed value
- `take`: computed value
- `relations`: `['users']` (retain existing relations)

Execute the query using `this.groupRepository.findAndCount(options)`.

### Step 3: Return formatted response

Shape the array and count into an object:

```typescript
return {
  items: groups,
  total: count,
  page,
  pageSize
};
```

---

## Acceptance Criteria

- [ ] `findAll()` signature accepts pagination and sort options.
- [ ] TypeORM's `findAndCount()` is used with correct `skip`, `take`, `where`, and `order`.
- [ ] Returns an object with `items`, `total`, `page`, and `pageSize`.
