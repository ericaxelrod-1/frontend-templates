# Roles Page Refactor

## Objective
Refactor the Roles page to implement server-side sorting, searching, and pagination, matching the capabilities recently added to the Groups page. Additionally, add a 5px vertical padding to the `mat-table` rows on the Groups page.

## End State
- The Groups page table rows will have improved spacing (5px inner top/bottom padding).
- The Roles page will utilize backend-driven pagination, sorting, and searching.
- The `RolesComponent` will use the "Industry-Standard RxJS Pattern" to manage data loading.
- `RolesService` (backend) will accurately filter and sort roles using `findAndCount`.

## Stories
This work is divided into two stories to ensure a logical progression:
1. **STORY-001**: Implement Server-Side Pagination & Sorting in the Backend
2. **STORY-002**: Refactor Frontend Roles Page Layout and Data Layer
