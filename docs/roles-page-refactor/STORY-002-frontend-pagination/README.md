# STORY-002: Frontend Server-Side Pagination & Sorting

## Objective
Refactor the frontend `RolesComponent` and `RoleService` to match the newly implemented backend paginated architecture, utilizing `mat-table` and RxJS observable streams.

## Value Proposition
Improves the frontend performance by loading dynamic chunks of data requested by the user viewport (searches, filtered sorts, pages) instead of the entire list of roles at once. It maintains consistency with the recently updated `GroupsComponent`.

## Requirements
- `RoleService.getRoles` must use `HttpParams` to send HTTP requests to the backend with pagination logic.
- `RolesComponent` must introduce `@ViewChild(MatSort)` and `@ViewChild(MatPaginator)`.
- `RolesComponent` must transition from an imperative initial loading pattern to a persistent RxJS event-driven pattern (`merge`, `switchMap`).
- `RolesComponent` template must include a `mat-paginator`, `matSort` properties on the `<table mat-table>`, an empty state placeholder row (`*matNoDataRow`), and a search input.
- Address any downstream type resolution issues within other components resulting from transitioning the signature of `RoleService.getRoles`.

## Implementation Tasks
The tasks to sequentially execute:
1. `TASK-001-update-role-service.md`
2. `TASK-002-redesign-roles-html.md`
3. `TASK-003-implement-reactive-pattern.md`
4. `TASK-004-fix-related-components.md`
5. `TASK-005-verification.md`
