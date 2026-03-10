# STORY-002: Refactor Sidebar Components to Use SidePanelService

## Overview

Refactor all 7 sidebar components to use `SidePanelService` instead of inline `position: fixed` CSS. Each component's template and styles are preserved but simplified — the `position: fixed` wrapper, z-index, backdrop element, and open/close CSS classes are removed. The parent components that open these sidebars are updated to call `sidePanelService.open()` instead of toggling a boolean.

## Pattern

Each refactored sidebar follows this pattern:

### Before (current anti-pattern)
```typescript
// Parent component
isGroupSelectorOpen = false;
openGroupSelector() { this.isGroupSelectorOpen = true; }
closeGroupSelector() { this.isGroupSelectorOpen = false; }

// Template
<app-group-selector-sidebar
  [isOpen]="isGroupSelectorOpen"
  [selectedGroupIds]="selectedGroupIds"
  (groupSelectionChange)="onGroupSelectionChange($event)"
  (closeSidebar)="closeGroupSelector()">
</app-group-selector-sidebar>
```

### After (CDK Overlay)
```typescript
// Parent component
openGroupSelector() {
  const ref = this.sidePanelService.open(GroupSelectorPanelComponent, {
    data: { selectedGroupIds: [...this.selectedGroupIds] },
    width: '400px'
  });
  ref.afterClosed().subscribe(result => {
    if (result) { this.selectedGroupIds = result; }
  });
}

// No template element needed — the service creates the overlay
```

### Panel component
```typescript
// Sidebar component (refactored)
@Component({
  template: `
    <div class="panel-header">...</div>
    <div class="panel-content">...</div>
    <div class="panel-actions">
      <button (click)="apply()">Apply Selection</button>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    /* No position:fixed, no z-index, no backdrop — CDK handles all of it */
  `]
})
export class GroupSelectorPanelComponent {
  constructor(
    @Inject(SIDE_PANEL_DATA) public data: { selectedGroupIds: number[] },
    private sidePanelRef: SidePanelRef
  ) {}

  apply() {
    this.sidePanelRef.close(this.selectedGroupIds);
  }
}
```

## Tasks

| # | Task | Description | Status |
|---|------|-------------|--------|
| 1 | [TASK-001](./TASK-001-refactor-group-selector-sidebar.md) | Refactor group-selector-sidebar → GroupSelectorPanelComponent | Open |
| 2 | [TASK-002](./TASK-002-refactor-role-selector-sidebar.md) | Refactor role-selector-sidebar → RoleSelectorPanelComponent | Open |
| 3 | [TASK-003](./TASK-003-refactor-role-creation-sidebar.md) | Refactor role-creation-sidebar → RoleCreationPanelComponent | Open |
| 4 | [TASK-004](./TASK-004-refactor-group-creation-sidebar.md) | Refactor group-creation-sidebar → GroupCreationPanelComponent | Open |
| 5 | [TASK-005](./TASK-005-refactor-member-actions-sidebar.md) | Refactor member-actions-sidebar → MemberActionsPanelComponent | Open |
| 6 | [TASK-006](./TASK-006-refactor-user-selector-sidebar.md) | Refactor user-selector-sidebar + generic-selector-sidebar → UserSelectorPanelComponent | Open |
| 7 | [TASK-007](./TASK-007-refactor-user-sidebar.md) | Refactor user-sidebar (layout) → UserProfilePanelComponent | Open |
| 8 | [TASK-008](./TASK-008-verify-all-sidebars.md) | Verify all sidebars work correctly in the running app | Open |

## Execution Notes

- Each task can be done independently after STORY-001 is complete
- Each task modifies TWO files: the sidebar component itself and its parent component
- The old sidebar component file can be renamed or replaced — the import path in the parent will be updated
- TASK-008 (verification) must be done after all other tasks in this story
