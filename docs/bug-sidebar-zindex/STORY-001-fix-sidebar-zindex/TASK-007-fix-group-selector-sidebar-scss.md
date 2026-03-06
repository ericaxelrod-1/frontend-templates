# TASK-007: Fix group-selector-sidebar SCSS File

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-007 |
| **Status** | Completed |
| **Story** | STORY-001: Fix Sidebar Z-Index Values |
| **Description** | Update the z-index values in the SCSS file of `group-selector-sidebar.component.scss` |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | None |

---

## Context

This SCSS file exists alongside `group-selector-sidebar.component.ts`, but the component currently uses **inline styles** (the `styles: [...]` array in the `.ts` file) rather than `styleUrls`. The SCSS file is not actively loaded by the component. However, it should still be updated to match the corrected z-index values so that:
1. The file does not contain misleading values
2. If the component is later refactored to use `styleUrls`, the values will already be correct

---

## Instructions

### File to Edit

**File**: `angular/frontend/src/app/features/users/group-selector-sidebar/group-selector-sidebar.component.scss`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/users/group-selector-sidebar/group-selector-sidebar.component.scss`

---

### Edit 1: Update the sidebar panel z-index

**Location**: Line 11 (inside the `.group-selector-sidebar` SCSS rule)

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

**Location**: Line 109 (inside the `.sidebar-backdrop` SCSS rule)

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

- [ ] `.group-selector-sidebar` has `z-index: 1200`
- [ ] `.sidebar-backdrop` has `z-index: 1199`
- [ ] No other code in the file is changed
