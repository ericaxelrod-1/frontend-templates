# TASK-001: Remove Unused SCSS Files

| Field | Value |
|-------|-------|
| **Task ID** | STORY-003 / TASK-001 |
| **Status** | Open |
| **Story** | STORY-003: Cleanup |
| **Description** | Remove orphaned SCSS files that are no longer referenced by any component |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | STORY-002 must be completed and verified first |

---

## Instructions

### Step 1: Identify orphaned files

After the STORY-002 refactoring, these SCSS files may no longer be referenced by any component:

1. `angular/frontend/src/app/features/users/group-selector-sidebar/group-selector-sidebar.component.scss` — The component was already using inline `styles` instead of `styleUrls`. Now that it's refactored with CDK Overlay, this file is definitely unused.

2. `angular/frontend/src/app/shared/components/generic-selector-sidebar/generic-selector-sidebar.component.scss` — After STORY-002/TASK-006, the `GenericSelectorSidebarComponent` is no longer used.

3. `angular/frontend/src/app/layouts/user-sidebar/user-sidebar.component.scss` — After STORY-002/TASK-007, the `UserSidebarComponent` uses inline styles.

### Step 2: Verify each file is not referenced

For each file, search for references:

```bash
grep -rn "group-selector-sidebar.component.scss" /home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/ --include="*.ts"
grep -rn "generic-selector-sidebar.component.scss" /home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/ --include="*.ts"
grep -rn "user-sidebar.component.scss" /home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/ --include="*.ts"
```

**Only delete files that return zero results.**

### Step 3: Delete unreferenced files

```bash
# Only run these if Step 2 confirmed no references
rm /home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/users/group-selector-sidebar/group-selector-sidebar.component.scss
rm /home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/shared/components/generic-selector-sidebar/generic-selector-sidebar.component.scss
rm /home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/layouts/user-sidebar/user-sidebar.component.scss
```

### Step 4: Also check if `generic-selector-sidebar.component.ts` itself is still referenced

```bash
grep -rn "generic-selector-sidebar\|GenericSelectorSidebar" /home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/ --include="*.ts"
```

If no results, delete the entire generic-selector-sidebar directory:
```bash
rm -rf /home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/shared/components/generic-selector-sidebar/
```

---

## Acceptance Criteria

- [ ] All orphaned SCSS files are deleted
- [ ] No remaining references to deleted files
- [ ] `npx ng build` succeeds
