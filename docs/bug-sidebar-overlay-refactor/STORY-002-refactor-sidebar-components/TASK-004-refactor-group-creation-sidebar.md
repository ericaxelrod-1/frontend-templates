# TASK-004: Refactor group-creation-sidebar → GroupCreationPanelComponent

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-004 |
| **Status** | Open |
| **Story** | STORY-002: Refactor Sidebar Components to Use SidePanelService |
| **Description** | Refactor `group-creation-sidebar.component.ts` to be a CDK Overlay panel component, and update `groups.component.ts` to open it via `SidePanelService` |
| **Estimated Effort** | 25 minutes |
| **Dependencies** | STORY-001 must be completed first |

---

## Context

`GroupCreationSidebarComponent` is a form-based sidebar for creating/editing groups. It uses `@Input() isOpen`, `@Input() groupData`, `@Output() closeSidebar`, and `@Output() groupSaved`. Follow the same pattern as TASK-003 (role-creation-sidebar).

---

## Files to Modify

### File 1: Refactor the sidebar component

**File**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/groups/group-creation-sidebar/group-creation-sidebar.component.ts`

Apply the same refactoring pattern as TASK-003:

1. **Update imports**: Remove `Input, Output, EventEmitter, OnChanges, SimpleChanges`. Add `Inject`. Add `SidePanelRef, SIDE_PANEL_DATA` import.
2. **Create data interface**:
   ```typescript
   export interface GroupCreationPanelData {
     groupData: Group | null;
   }
   ```
3. **Remove from template**: The `.group-creation-sidebar` wrapper div (with `[class.sidebar-open]="isOpen"`) and the `.sidebar-backdrop` div. Keep the inner `.sidebar-content` as the root.
4. **Remove from CSS**: The `.group-creation-sidebar` rule (with `position: fixed`, `z-index: 1200`, `transform`) and the `.sidebar-backdrop` rule. Add `:host { display: flex; flex-direction: column; height: 100%; overflow-y: auto; }`.
5. **Replace class properties**:
   - Remove `@Input() isOpen`, `@Input() groupData`, `@Output() closeSidebar`, `@Output() groupSaved`
   - Add `groupData: Group | null = null;`
6. **Update constructor**:
   ```typescript
   constructor(
     private sidePanelRef: SidePanelRef,
     @Inject(SIDE_PANEL_DATA) public panelData: GroupCreationPanelData
   ) {
     this.groupData = panelData.groupData;
     this.editMode = !!this.groupData;
     this.resetForm();
   }
   ```
7. **Remove** `ngOnChanges` method
8. **Update** `onCloseSidebar()` → `this.sidePanelRef.close()`
9. **Update** `onSave()` → replace `this.groupSaved.emit(groupToSave)` with `this.sidePanelRef.close(groupToSave)`

---

### File 2: Update groups.component.ts

**File**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/groups/groups.component.ts`

1. **Add import**: `SidePanelService` from `../../shared/components/side-panel`
2. **Remove** `GroupCreationSidebarComponent` from the `imports` array
3. **Remove** `<app-group-creation-sidebar>` from the template (lines 115-121)
4. **Inject** `SidePanelService` in the constructor
5. **Update** `createGroup()` and `editGroup()`:
   ```typescript
   createGroup(): void {
     this.openGroupPanel(null);
   }

   editGroup(group: Group): void {
     this.openGroupPanel(group);
   }

   private openGroupPanel(groupData: Group | null): void {
     const ref = this.sidePanelService.open(GroupCreationSidebarComponent, {
       data: { groupData },
       width: '400px'
     });
     ref.afterClosed().subscribe(result => {
       if (result) {
         this.onGroupSaved(result);
       }
     });
   }
   ```
6. **Remove**: `isGroupCreationOpen`, `selectedGroupForEdit`, `closeGroupCreation()`. Keep `onGroupSaved()`.

---

## Acceptance Criteria

- [ ] `GroupCreationSidebarComponent` no longer has `position: fixed` or z-index CSS
- [ ] `GroupCreationSidebarComponent` uses `SidePanelRef` and `SIDE_PANEL_DATA`
- [ ] `groups.component.ts` opens the panel via `SidePanelService.open()`
- [ ] Create and edit modes both work correctly
- [ ] No compilation errors
