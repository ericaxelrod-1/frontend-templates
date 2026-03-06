# Groups Page Refactor

## Objective

Refactor the Groups page (`/app/groups`) to match the Roles page layout by switching from a card grid to a material table (`mat-table`). Additionally, implement server-side searching, sorting, and pagination as defined by the `.cursor/rules/150-angular-server-side-sorting.mdc` guide to ensure performance and scalability.

## End State

- The backend `/groups` endpoint accepts `page`, `pageSize`, `sortBy`, `sortDirection`, and `search` query parameters.
- The backend returns a generic `ServerResponse<Group>` structure.
- The Angular frontend includes a generic `ServerResponse<T>` interface model.
- The `GroupService` correctly fetches paginated and sorted data.
- The `GroupsComponent` uses a `mat-table` view structure.
- The reactive data-loading pattern is fully implemented without race conditions (proper `ViewChild` coordination).

## Stories

| # | Story | Description | Status |
|---|-------|-------------|--------|
| 1 | [STORY-001](./STORY-001-backend-pagination/) | Implement Backend Server-Side Pagination & Sorting | Open |
| 2 | [STORY-002](./STORY-002-frontend-pagination/) | Refactor Frontend Groups Page Layout and Data Layer | Open |

## Execution Order

Stories must be executed in order. STORY-001 must be completed and verified before STORY-002 begins to ensure the backend is ready to accept the new queries from the frontend.
