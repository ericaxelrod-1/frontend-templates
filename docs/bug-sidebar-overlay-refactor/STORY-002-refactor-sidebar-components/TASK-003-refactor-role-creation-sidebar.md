# TASK-003: Refactor role-creation-sidebar → RoleCreationPanelComponent

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-003 |
| **Status** | Open |
| **Story** | STORY-002: Refactor Sidebar Components to Use SidePanelService |
| **Description** | Refactor `role-creation-sidebar.component.ts` to be a CDK Overlay panel component, and update `roles.component.ts` to open it via `SidePanelService` |
| **Estimated Effort** | 30 minutes |
| **Dependencies** | STORY-001 must be completed first |

---

## Context

`RoleCreationSidebarComponent` is a form-based sidebar used on the Roles page for both creating and editing roles. It uses `@Input() isOpen`, `@Input() roleData` (for edit mode), `@Output() closeSidebar`, and `@Output() roleSaved`. It has complex permission management with grouped accordion, select-all, etc.

After refactoring: The component receives `roleData` via `SIDE_PANEL_DATA` and returns the saved role via `SidePanelRef.close(result)`.

---

## Files to Modify

### File 1: Refactor the sidebar component

**File**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/roles/role-creation-sidebar/role-creation-sidebar.component.ts`

**Changes to make** (do NOT rewrite the entire file — apply these specific changes):

#### 1a. Update imports (lines 1-12)

**Find:**
```typescript
import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
```

**Replace with:**
```typescript
import { Component, OnInit, Inject } from '@angular/core';
```

**Add after the last import:**
```typescript
import { SidePanelRef, SIDE_PANEL_DATA } from '../../../shared/components/side-panel';

export interface RoleCreationPanelData {
  roleData: Role | null;
}
```

#### 1b. Remove the backdrop and outermost wrapper from the template (lines 36-43, 168-169)

**Remove from template:**
```html
    <!-- Sidebar Backdrop -->
    <div class="sidebar-backdrop" 
         [class.backdrop-visible]="isOpen" 
         (click)="onCloseSidebar()">
    </div>
    
    <!-- Sidebar -->
    <div class="role-creation-sidebar" [class.sidebar-open]="isOpen">
```
**And the closing `</div>` at line 169.**

**Replace with:** Just keep the inner `<div class="sidebar-content">` as the root element.

**Add to the template at the top level:**
```html
    <div class="sidebar-content">
```

#### 1c. Remove the position:fixed and backdrop CSS (lines 172-208)

**Remove** the `.role-creation-sidebar` rule (with `position: fixed`, `z-index`, `transform`) and the `.sidebar-backdrop` rule entirely.

**Add instead:**
```css
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow-y: auto;
    }
```

#### 1d. Replace the @Input/@Output class properties and constructor (lines 340-358)

**Remove:**
```typescript
  @Input() isOpen = false;
  @Input() roleData: Role | null = null;
  @Output() closeSidebar = new EventEmitter<void>();
  @Output() roleSaved = new EventEmitter<Partial<Role>>();
```

**Replace with:**
```typescript
  roleData: Role | null = null;
```

**Update constructor:**
```typescript
  constructor(
    private roleService: RoleService,
    private sidePanelRef: SidePanelRef,
    @Inject(SIDE_PANEL_DATA) public panelData: RoleCreationPanelData
  ) {
    this.roleData = panelData.roleData;
    this.editMode = !!this.roleData;
    this.resetForm();
  }
```

#### 1e. Remove ngOnChanges (lines 364-369)

**Remove** the entire `ngOnChanges` method — it handled `isOpen` and `roleData` input changes, which are no longer needed.

#### 1f. Update onCloseSidebar and onSave methods

**Replace `onCloseSidebar()`:**
```typescript
  onCloseSidebar(): void {
    this.sidePanelRef.close();
  }
```

**In `onSave()`, replace `this.roleSaved.emit(roleToSave)` with:**
```typescript
    this.sidePanelRef.close(roleToSave);
```

---

### File 2: Update roles.component.ts

**File**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/roles/roles.component.ts`

#### 2a. Add import
```typescript
import { SidePanelService } from '../../shared/components/side-panel';
```

#### 2b. Remove `RoleCreationSidebarComponent` from the `imports` array

#### 2c. Remove `<app-role-creation-sidebar>` from the template (lines 107-113)

#### 2d. Inject `SidePanelService` in the constructor

#### 2e. Update `createRole()` and `editRole()`:

```typescript
  createRole(): void {
    this.openRolePanel(null);
  }

  editRole(role: Role): void {
    if (!role.id) {
      this.snackBar.open('Cannot edit role without an ID', 'Close', { duration: 3000 });
      return;
    }
    this.openRolePanel(role);
  }

  private openRolePanel(roleData: Role | null): void {
    const ref = this.sidePanelService.open(RoleCreationSidebarComponent, {
      data: { roleData },
      width: '600px'
    });
    ref.afterClosed().subscribe(result => {
      if (result) {
        this.onRoleSaved(result);
      }
    });
  }
```

#### 2f. Remove the old sidebar state properties
- Remove `isRoleCreationOpen`
- Remove `selectedRoleForEdit`
- Remove `closeRoleCreation()`
- Keep `onRoleSaved()` (it handles the API call)

**Update `onRoleSaved()` to not call `closeRoleCreation()` (the panel is already closed):**

```typescript
  onRoleSaved(roleData: Partial<Role>): void {
    // ... keep the existing API call logic, but remove closeRoleCreation() calls ...
    // The panel already closed itself before emitting the result
  }
```

---

## Acceptance Criteria

- [ ] `RoleCreationSidebarComponent` no longer has `position: fixed` or z-index CSS
- [ ] `RoleCreationSidebarComponent` uses `SidePanelRef` and `SIDE_PANEL_DATA`
- [ ] `roles.component.ts` opens the panel via `SidePanelService.open()` with `width: '600px'`
- [ ] Create and edit modes both work correctly
- [ ] Permission selection (accordion, select-all) still works
- [ ] No compilation errors
