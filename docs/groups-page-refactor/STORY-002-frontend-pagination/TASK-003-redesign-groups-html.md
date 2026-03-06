# TASK-003: Redesign Groups HTML Template

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-003 |
| **Status** | Open |
| **Story** | STORY-002: Refactor Frontend Groups Page Layout and Data Layer |
| **Description** | Replace `mat-card` grid layout with a `mat-table` layout matching the roles page, ensuring the `mat-table` always renders so `ViewChild` does not error out. |
| **Estimated Effort** | 20 minutes |
| **Dependencies** | None |

---

## Instructions

### Step 1: Open Groups UI Template

Open `angular/frontend/src/app/features/groups/groups.component.html` (or inline template in `.ts`).

### Step 2: Replace Grid with Table

Remove the `.groups-grid` and nested `mat-card` loops. Replace with a standard `mat-table`.

Use the required structure from the sorting rules:

```html
<mat-table [dataSource]="dataSource" matSort>
  <!-- Columns defined inside ... -->
</mat-table>
```

### Step 3: Implement Columns

Columns: Name, Owner, Description, Members Count, Actions. Use `matColumnDef="property"`. Implement `mat-sort-header` correctly mapped to backend query strings:

- `name`
- `description`

Note: Owner and Members Count might not support sorting at the DB level efficiently based on our current TypeORM structure, so consider keeping them disabled for sort, or adding an `owner.firstName` sort logic appropriately.

### Step 4: Implement Empty States & Spinners

Use `loading` variables to display spinners while waiting for data. Implement empty states *inside* the table structure (never `*ngIf` around `mat-table`).
Add an input search field at the top for triggering ILike filtering. Ensure there is a `mat-paginator` below the table bound to `totalCount`.

---

## Acceptance Criteria

- [ ] A `mat-table` is implemented and replaces the `mat-card` design.
- [ ] No `*ngIf` guards the `<mat-table>`.
- [ ] Columns map properly to Group model payload properties.
- [ ] `<mat-paginator>` allows switching page counts.
