# TASK-008: Fix user-sidebar SCSS File

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-008 |
| **Status** | Completed |
| **Story** | STORY-001: Fix Sidebar Z-Index Values |
| **Description** | Update the z-index values in the SCSS file of `user-sidebar.component.scss` for consistency |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | None |

---

## Context

The user-sidebar is a **layout-level** component rendered outside `mat-sidenav-content` (directly inside `custom-layout.component.ts` template). It currently works at `z-index: 1100/1099` because it sits outside the stacking context that traps other sidebars. However, we are updating it to `1200/1199` for **consistency** with all other sidebar components. This ensures that if the layout is ever refactored, the user-sidebar will not regress.

---

## Instructions

### File to Edit

**File**: `angular/frontend/src/app/layouts/user-sidebar/user-sidebar.component.scss`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/layouts/user-sidebar/user-sidebar.component.scss`

---

### Edit 1: Update the sidebar panel z-index

**Location**: Line 13 (inside the `.user-sidebar` SCSS rule)

**Find this line:**

```scss
  z-index: 1100;
```

**Replace with:**

```scss
  z-index: 1200;
```

---

### Edit 2: Update the backdrop z-index

**Location**: Line 93 (inside the `.sidebar-backdrop` SCSS rule)

**Find this line:**

```scss
  z-index: 1099;
```

**Replace with:**

```scss
  z-index: 1199;
```

---

## How to Verify

1. Open the file and confirm the two z-index values are now `1200` and `1199`
2. Make sure no other code in the file was changed

---

## Acceptance Criteria

- [ ] `.user-sidebar` has `z-index: 1200`
- [ ] `.sidebar-backdrop` has `z-index: 1199`
- [ ] No other code in the file is changed
