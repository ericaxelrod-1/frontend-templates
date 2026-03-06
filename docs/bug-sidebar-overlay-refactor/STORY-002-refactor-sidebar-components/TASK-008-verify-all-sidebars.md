# TASK-008: Verify All Sidebars Work in the Running App

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-008 |
| **Status** | Open |
| **Story** | STORY-002: Refactor Sidebar Components to Use SidePanelService |
| **Description** | Build the app and manually test every refactored sidebar to confirm it works correctly |
| **Estimated Effort** | 20 minutes |
| **Dependencies** | TASK-001 through TASK-007 must all be completed first |

---

## Instructions

### Step 1: Build the application

```bash
cd /home/eaxelrod/GitHub/frontend-templates/angular/frontend
npx ng build
```

The build must complete with zero errors.

### Step 2: Start the development server

```bash
cd /home/eaxelrod/GitHub/frontend-templates/angular/frontend
npm run start
```

### Step 3: Verify no remaining position:fixed sidebar CSS

```bash
grep -rn "position: fixed" /home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/ \
  --include="*.ts" --include="*.scss" \
  | grep -v node_modules \
  | grep -v "login\|header\|footer\|debug"
```

**Expected**: No results from any sidebar component files. Only non-sidebar components should remain.

### Step 4: Test each sidebar

Log into the app and test each sidebar on its respective page:

| # | Page | Action | What to Test |
|---|------|--------|------------|
| 1 | Create User (`/app/users/create`) | Click "Select Groups" | Group selector panel opens from right, checkboxes work, Apply returns selections |
| 2 | Create User (`/app/users/create`) | Click "Select Roles" | Role selector panel opens, checkboxes work, Apply returns selections |
| 3 | Roles (`/app/roles`) | Click "Create Role" | Role creation form opens, form validates, Create saves and closes |
| 4 | Roles (`/app/roles`) | Click Edit on a role | Role editing form opens with data populated, Save updates and closes |
| 5 | Groups (`/app/groups`) | Click "Create Group" | Group creation form opens, form validates, Create saves and closes |
| 6 | Groups (`/app/groups`) | Click Edit on a group | Group editing form opens with data, Save updates and closes |
| 7 | Groups (`/app/groups`) | Click "Add Member" | User selector panel opens, clicking a user adds them to the group |
| 8 | Groups (`/app/groups`) | Click "⋮" on a member | Member actions panel opens, actions are clickable |
| 9 | Any page | Click user avatar in header | User profile panel opens with navigation links that work |

For each sidebar, verify:
- [ ] Panel slides in from the right edge
- [ ] Panel is NOT blocked by the header or footer
- [ ] Clicking the dark backdrop closes the panel
- [ ] Pressing Escape closes the panel
- [ ] The close (X) button works
- [ ] All interactive elements (buttons, checkboxes, form fields) are clickable
- [ ] Focus is trapped inside the panel (Tab key cycles within panel)

---

## Acceptance Criteria

- [ ] `npx ng build` completes with zero errors
- [ ] All 9 sidebars open correctly and are fully interactive
- [ ] No sidebar is blocked by the header or footer
- [ ] Backdrop click and Escape key close all panels
- [ ] Focus trapping works on all panels
