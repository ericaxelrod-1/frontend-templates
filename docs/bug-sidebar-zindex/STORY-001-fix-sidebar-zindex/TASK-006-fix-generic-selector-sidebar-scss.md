# TASK-006: Fix generic-selector-sidebar SCSS File

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-006 |
| **Status** | Completed |
| **Story** | STORY-001: Fix Sidebar Z-Index Values |
| **Description** | Update the z-index values in the SCSS file of `generic-selector-sidebar.component.scss` |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | None |

---

## Instructions

### File to Edit

**File**: `angular/frontend/src/app/shared/components/generic-selector-sidebar/generic-selector-sidebar.component.scss`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/shared/components/generic-selector-sidebar/generic-selector-sidebar.component.scss`

---

### Edit 1: Update the sidebar panel z-index

**Location**: Line 11 (inside the `.generic-selector-sidebar` SCSS rule)

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

**Location**: Line 114 (inside the `.sidebar-backdrop` SCSS rule)

**Find this line:**

```scss
  z-index: 1099;
```

**Replace with:**

```scss
  z-index: 1199;
```

---

## Context

This component is used by `user-selector-sidebar.component.ts` (in `features/groups/user-selector-sidebar/`), which wraps this generic sidebar to provide user selection on the Groups page. Fixing this SCSS file fixes the user-selector-sidebar as well.

---

## How to Verify

1. Open the file and confirm the two z-index values are now `1200` and `1199`
2. Make sure no other code in the file was changed

---

## Acceptance Criteria

- [ ] `.generic-selector-sidebar` has `z-index: 1200`
- [ ] `.sidebar-backdrop` has `z-index: 1199`
- [ ] No other code in the file is changed
