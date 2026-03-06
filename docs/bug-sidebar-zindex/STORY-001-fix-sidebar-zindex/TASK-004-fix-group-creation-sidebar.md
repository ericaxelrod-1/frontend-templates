# TASK-004: Fix group-creation-sidebar Inline Styles

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-004 |
| **Status** | Completed |
| **Story** | STORY-001: Fix Sidebar Z-Index Values |
| **Description** | Update the z-index values in the inline styles of `group-creation-sidebar.component.ts` |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | None |

---

## Instructions

### File to Edit

**File**: `angular/frontend/src/app/features/groups/group-creation-sidebar/group-creation-sidebar.component.ts`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/groups/group-creation-sidebar/group-creation-sidebar.component.ts`

---

### Edit 1: Update the sidebar panel z-index

**Location**: Line 114 (inside the `styles` array, within the `.group-creation-sidebar` CSS rule)

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

**Location**: Line 130 (inside the `styles` array, within the `.sidebar-backdrop` CSS rule)

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

- [ ] `.group-creation-sidebar` has `z-index: 1200`
- [ ] `.sidebar-backdrop` has `z-index: 1199`
- [ ] No other code in the file is changed
