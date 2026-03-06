# TASK-005: Final UX and Functionality Verification

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-005 |
| **Status** | Open |
| **Story** | STORY-002: Refactor Frontend Groups Page Layout and Data Layer |
| **Description** | Fully test and verify all end-to-end changes of the `/groups` feature map, sorting permutations, and performance patterns. |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | TASK-004 |

---

## Instructions

### Step 1: Build execution

Compile and build the angular framework, confirming no linters or typings fail:

```bash
cd angular/frontend
npm run build
```

### Step 2: Test permutations
1. Sorting: Click Name desc/asc repeatedly, monitoring the network logs to ensure `pageSize` and `sortBy` query flags change appropriately.
2. Search: Filter `Admins`, verifying it issues single API debounced calls and properly populates rows.
3. Pagination: Create 15 groups, view page 2 with `pageSize=10` limits.
4. Error States: Validate no console errors appear like NG0100 (Change Detection violation on Aria labels).

---

## Acceptance Criteria

- [ ] End to end verification tests are successful.
- [ ] No `Angular Error NG0100` occurs.
- [ ] `mat-table` styling mirrors `roles.component.ts`.
