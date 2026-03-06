# TASK-002: Refactor GroupService getGroups

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-002 |
| **Status** | Open |
| **Story** | STORY-002: Refactor Frontend Groups Page Layout and Data Layer |
| **Description** | Change the `GroupService` to hit the REST API with all necessary sorting and pagination payload fields. |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | TASK-001 |

---

## Instructions

### Step 1: Adjust the GroupService parameters

Open `angular/frontend/src/app/services/group.service.ts`.

Update `getGroups(params?: any)` query function so it passes through the correct payload fields (`sortBy`, `sortDirection`, `page`, `pageSize`, `search`).

### Step 2: Build `HttpParams`

Import `HttpParams` from `@angular/common/http`. Loop through the keys in the arguments and `append` to build an HTTP query string, handling un-set and null params to avoid cluttering REST queries.

### Step 3: Return Observable Generic

Replace the return type from `Observable<Group[]>` to `Observable<ServerResponse<Group>>`.

---

## Acceptance Criteria

- [ ] `GroupService.getGroups()` accepts an option parameters argument for HTTP.
- [ ] Returns `Observable<ServerResponse<Group>>`.
