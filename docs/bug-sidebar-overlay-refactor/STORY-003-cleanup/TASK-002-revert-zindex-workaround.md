# TASK-002: Revert Z-Index Workaround

| Field | Value |
|-------|-------|
| **Task ID** | STORY-003 / TASK-002 |
| **Status** | Open |
| **Story** | STORY-003: Cleanup |
| **Description** | The z-index values changed in `docs/bug-sidebar-zindex/` are no longer relevant since the sidebar components now use CDK Overlay. Verify no sidebar component code still references old z-index values. |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | STORY-002 must be completed first |

---

## Instructions

### Step 1: Verify no sidebar z-index references remain

```bash
grep -rn "z-index: 1200\|z-index: 1199\|z-index: 1100\|z-index: 1099" \
  /home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/ \
  --include="*.ts" --include="*.scss" \
  | grep -v node_modules
```

**Expected**: No results from any sidebar component files. The refactored components no longer use z-index at all — CDK Overlay manages stacking. Only layout components (header, footer) may still have z-index values, which is correct.

### Step 2: Archive the old fix documentation

The `docs/bug-sidebar-zindex/` documentation from the initial z-index fix attempt is now superseded by `docs/bug-sidebar-overlay-refactor/`. It can be left in place for historical reference but should be marked as superseded.

Add a note to the top of `docs/bug-sidebar-zindex/README.md`:

```markdown
> [!NOTE]
> This fix has been superseded by [bug-sidebar-overlay-refactor](../bug-sidebar-overlay-refactor/). The z-index approach only partially addressed the issue. The root cause was that `position: fixed` CSS inside `mat-sidenav-content` creates a stacking context trap. The proper fix uses Angular CDK Overlay to render sidebars outside the stacking context entirely.
```

---

## Acceptance Criteria

- [ ] No sidebar component uses z-index values
- [ ] `docs/bug-sidebar-zindex/README.md` has a superseded note
