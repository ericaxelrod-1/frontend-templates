# TASK-005: Refactor member-actions-sidebar → MemberActionsPanelComponent

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-005 |
| **Status** | Open |
| **Story** | STORY-002: Refactor Sidebar Components to Use SidePanelService |
| **Description** | Refactor `member-actions-sidebar.component.ts` to be a CDK Overlay panel component, and update `groups.component.ts` to open it via `SidePanelService` |
| **Estimated Effort** | 25 minutes |
| **Dependencies** | STORY-001 must be completed first |

---

## Context

`MemberActionsSidebarComponent` shows available actions (Make Admin, Remove from Group) for a selected group member. It uses `@Input() isOpen`, `@Input() member`, `@Input() group`, `@Output() closeSidebar`, and `@Output() actionSelected`. When an action is clicked, it emits the action event and the parent handles the API call.

After refactoring: The component receives `member` and `group` via `SIDE_PANEL_DATA` and returns the selected action via `SidePanelRef.close(result)`.

Note: The `MemberAction` interface must remain exported from this file since `groups.component.ts` imports it.

---

## Files to Modify

### File 1: Refactor the sidebar component

**File**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/groups/member-actions-sidebar/member-actions-sidebar.component.ts`

1. **Update imports**: Remove `Input, Output, EventEmitter, OnChanges, SimpleChanges`. Add `Inject`. Add `SidePanelRef, SIDE_PANEL_DATA` import.
2. **Create data interface** (keep `MemberAction` interface as-is):
   ```typescript
   export interface MemberActionsPanelData {
     member: User;
     group: Group;
   }
   ```
3. **Remove from template**: The `.member-actions-sidebar` wrapper div (with `[class.sidebar-open]="isOpen"`) and the `.sidebar-backdrop` div. Keep the inner `.sidebar-content` as the root.
4. **Remove from CSS**: The `.member-actions-sidebar` rule (with `position: fixed`, `z-index: 1200`, `transform`) and the `.sidebar-backdrop` rule. Add `:host { display: flex; flex-direction: column; height: 100%; }`.
5. **Replace class properties**:
   - Remove `@Input() isOpen`, `@Input() member`, `@Input() group`, `@Output() closeSidebar`, `@Output() actionSelected`
   - Add:
     ```typescript
     member: User;
     group: Group;
     ```
6. **Update constructor**:
   ```typescript
   constructor(
     private sidePanelRef: SidePanelRef,
     @Inject(SIDE_PANEL_DATA) public panelData: MemberActionsPanelData
   ) {
     this.member = panelData.member;
     this.group = panelData.group;
     this.updateAvailableActions();
   }
   ```
7. **Remove** `ngOnChanges` method
8. **Update** `onCloseSidebar()` → `this.sidePanelRef.close()`
9. **Update** `onActionSelected()`:
   ```typescript
   onActionSelected(action: MemberAction): void {
     this.sidePanelRef.close({ action, member: this.member, group: this.group });
   }
   ```

---

### File 2: Update groups.component.ts

**File**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/groups/groups.component.ts`

1. **Add import**: `SidePanelService` from `../../shared/components/side-panel` (if not already added in TASK-004)
2. **Remove** `MemberActionsSidebarComponent` from the `imports` array
3. **Remove** `<app-member-actions-sidebar>` from the template (lines 106-113)
4. **Update** `openMemberActions()`:
   ```typescript
   openMemberActions(group: Group, member: User): void {
     const ref = this.sidePanelService.open(MemberActionsSidebarComponent, {
       data: { member, group },
       width: '400px'
     });
     ref.afterClosed().subscribe(result => {
       if (result) {
         this.onMemberActionSelected(result);
       }
     });
   }
   ```
5. **Remove**: `isMemberActionsOpen`, `selectedMember`, `selectedGroupForMember`, `closeMemberActions()`. Keep `onMemberActionSelected()`.

---

## Acceptance Criteria

- [ ] `MemberActionsSidebarComponent` no longer has `position: fixed` or z-index CSS
- [ ] `MemberActionsSidebarComponent` uses `SidePanelRef` and `SIDE_PANEL_DATA`
- [ ] `MemberAction` interface is still exported from the component file
- [ ] `groups.component.ts` opens the panel via `SidePanelService.open()`
- [ ] Clicking an action returns the result to the parent
- [ ] No compilation errors
