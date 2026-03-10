# TASK-001: Fix group-selector-sidebar Inline Styles

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-001 |
| **Status** | Completed |
| **Story** | STORY-001: Fix Sidebar Z-Index Values |
| **Description** | Update the z-index values in the inline styles of `group-selector-sidebar.component.ts` |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | None |

---

## Instructions

### File to Edit

**File**: `angular/frontend/src/app/features/users/group-selector-sidebar/group-selector-sidebar.component.ts`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/users/group-selector-sidebar/group-selector-sidebar.component.ts`

---

### Edit 1: Update the backdrop z-index

**Location**: Line 85 (inside the `styles` array, within the `.sidebar-backdrop` CSS rule)

**Find this line:**

```css
      z-index: 1000;
```

**Replace with:**

```css
      z-index: 1199;
```

---

### Edit 2: Update the sidebar panel z-index

**Location**: Line 104 (inside the `styles` array, within the `.sidebar` CSS rule)

**Find this line:**

```css
      z-index: 1001;
```

**Replace with:**

```css
      z-index: 1200;
```

---

## How to Verify

1. Open the file and confirm the two z-index values are now `1199` and `1200`
2. Make sure no other code in the file was changed

---

## Acceptance Criteria

- [ ] `.sidebar-backdrop` has `z-index: 1199`
- [ ] `.sidebar` has `z-index: 1200`
- [ ] No other code in the file is changed
