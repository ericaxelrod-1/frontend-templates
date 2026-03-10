# TASK-003: Fix role-creation-sidebar Inline Styles

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-003 |
| **Status** | Completed |
| **Story** | STORY-001: Fix Sidebar Z-Index Values |
| **Description** | Update the z-index values in the inline styles of `role-creation-sidebar.component.ts` |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | None |

---

## Instructions

### File to Edit

**File**: `angular/frontend/src/app/features/roles/role-creation-sidebar/role-creation-sidebar.component.ts`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/roles/role-creation-sidebar/role-creation-sidebar.component.ts`

---

### Edit 1: Update the sidebar panel z-index

**Location**: Line 182 (inside the `styles` array, within the `.role-creation-sidebar` CSS rule)

**Find this line:**

```css
      z-index: 1100;
```

**Replace with:**

```css
      z-index: 1200;
```

---

### Edit 2: Update the backdrop z-index

**Location**: Line 199 (inside the `styles` array, within the `.sidebar-backdrop` CSS rule)

**Find this line:**

```css
      z-index: 1099;
```

**Replace with:**

```css
      z-index: 1199;
```

---

## How to Verify

1. Open the file and confirm the two z-index values are now `1200` and `1199`
2. Make sure no other code in the file was changed

---

## Acceptance Criteria

- [ ] `.role-creation-sidebar` has `z-index: 1200`
- [ ] `.sidebar-backdrop` has `z-index: 1199`
- [ ] No other code in the file is changed
