# TASK-004: Implement GroupsComponent Reactive Pattern

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-004 |
| **Status** | Open |
| **Story** | STORY-002: Refactor Frontend Groups Page Layout and Data Layer |
| **Description** | Convert imperative `loadGroups` into the reactive sorting/pagination scheme with proper lifecycle coordination as outlined in `150-angular-server-side-sorting.mdc`. |
| **Estimated Effort** | 30 minutes |
| **Dependencies** | TASK-002, TASK-003 |

---

## Instructions

### Step 1: Coordinate Lifecycle Patterns

Open `angular/frontend/src/app/features/groups/groups.component.ts`.

Add `ViewChild` for `MatSort` and `MatPaginator`.
In `ngOnInit`, trigger permissions logic async. Only when done and ViewChild logic is ready should you attempt to initialize the stream.
In `ngAfterViewInit`, check if data requirements are fulfilled and initialize the reactive pattern.

### Step 2: RxJS Flow

Follow the "Industry-Standard RxJS Pattern":
```typescript
merge(
  this.sort.sortChange,
  this.paginator.page,
  this.searchControl.valueChanges.pipe(debounceTime(300))
)
.pipe(
  startWith({}),
  switchMap(() => {
    // Return observable map from GroupService
  })
)
```

Map variables properly internally: `this.dataSource = data.items;`, `this.totalCount = data.total`.
Ensure the default sorting parameters are applied effectively via setTimeout or template `matSortActive`.

### Step 3: Action Refreshes

Update functions like `onGroupSaved()`, `deleteGroup()`, `onUserSelected()` so they call `paginator.firstPage()` or manually trigger a new stream event, rather than mutating arrays directly. They must fetch fresh sorted paginated data to stay accurate.

---

## Acceptance Criteria

- [ ] Reactive pattern `merge(sort, pagination, search)` handles API queries.
- [ ] No recursive `ViewChild` loading logic occurs.
- [ ] Adding/Removing users or groups repaginates and fetches fresh data.
- [ ] Default `sortBy` does not trigger an Angular NG0100 error.
