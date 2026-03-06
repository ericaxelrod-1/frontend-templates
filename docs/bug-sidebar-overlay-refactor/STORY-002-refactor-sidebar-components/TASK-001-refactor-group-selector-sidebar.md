# TASK-001: Refactor group-selector-sidebar → GroupSelectorPanelComponent

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-001 |
| **Status** | Open |
| **Story** | STORY-002: Refactor Sidebar Components to Use SidePanelService |
| **Description** | Refactor `group-selector-sidebar.component.ts` to be a CDK Overlay panel component, and update `create-user.component.ts` to open it via `SidePanelService` |
| **Estimated Effort** | 30 minutes |
| **Dependencies** | STORY-001 must be completed first |

---

## Context

Currently, `GroupSelectorSidebarComponent` uses `position: fixed` CSS with a custom backdrop. It's embedded in the `create-user.component.ts` template with `[isOpen]`, `(groupSelectionChange)`, and `(closeSidebar)` bindings. The selections are applied **live** as checkboxes are toggled (via `groupSelectionChange` events). The "Apply Selection" button simply closes the sidebar.

After refactoring: The component will be opened via `SidePanelService.open()`. It will receive data via `SIDE_PANEL_DATA` and use `SidePanelRef` to close. The `position: fixed`, backdrop, and z-index CSS will be removed entirely — CDK Overlay handles all of that.

---

## Files to Modify

### File 1: Refactor the sidebar component

**File**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/users/group-selector-sidebar/group-selector-sidebar.component.ts`

Replace the entire file contents with the following:

```typescript
import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { GroupService } from '../../../services/group.service';
import { Group } from '../../../models/group.model';
import { SidePanelRef, SIDE_PANEL_DATA } from '../../../shared/components/side-panel';

export interface GroupSelectorPanelData {
  selectedGroupIds: number[];
}

@Component({
  selector: 'app-group-selector-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatDividerModule
  ],
  template: `
    <div class="sidebar-header">
      <h3>Select Groups</h3>
      <button mat-icon-button (click)="close()" class="close-button">
        <mat-icon>close</mat-icon>
      </button>
    </div>

    <mat-divider></mat-divider>

    <div class="sidebar-content">
      <div class="selection-info">
        <p>{{ selectedGroupIds.length }} group(s) selected</p>
      </div>

      <div class="groups-list">
        <div 
          *ngFor="let group of availableGroups" 
          class="group-item"
          [class.selected]="isGroupSelected(group.id)"
        >
          <mat-checkbox 
            [checked]="isGroupSelected(group.id)"
            (change)="toggleGroup(group.id)"
            class="group-checkbox"
          >
            <div class="group-info">
              <div class="group-name">{{ group.name }}</div>
              <div class="group-description" *ngIf="group.description">
                {{ group.description }}
              </div>
            </div>
          </mat-checkbox>
        </div>
      </div>

      <div class="empty-state" *ngIf="availableGroups.length === 0">
        <mat-icon>group</mat-icon>
        <p>No groups available</p>
      </div>
    </div>

    <mat-divider></mat-divider>

    <div class="sidebar-actions">
      <button mat-button (click)="clearAll()" [disabled]="selectedGroupIds.length === 0">
        Clear All
      </button>
      <button mat-raised-button color="primary" (click)="apply()">
        Apply Selection
      </button>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .sidebar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid #e0e0e0;
    }

    .sidebar-header h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 500;
    }

    .close-button {
      color: #666;
    }

    .sidebar-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
    }

    .selection-info {
      margin-bottom: 16px;
      padding: 12px;
      background-color: #f5f5f5;
      border-radius: 4px;
      font-size: 14px;
      color: #666;
    }

    .groups-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .group-item {
      padding: 12px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      transition: all 0.2s ease;
      cursor: pointer;
    }

    .group-item:hover {
      background-color: #f5f5f5;
      border-color: #ccc;
    }

    .group-item.selected {
      background-color: #e8f5e8;
      border-color: #4caf50;
    }

    .group-checkbox {
      width: 100%;
    }

    .group-info {
      margin-left: 8px;
    }

    .group-name {
      font-weight: 500;
      color: #333;
      margin-bottom: 4px;
    }

    .group-description {
      font-size: 12px;
      color: #666;
      line-height: 1.4;
    }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: #666;
    }

    .empty-state mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .sidebar-actions {
      padding: 16px 20px;
      border-top: 1px solid #e0e0e0;
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
  `]
})
export class GroupSelectorSidebarComponent implements OnInit {
  selectedGroupIds: number[] = [];
  availableGroups: Group[] = [];

  constructor(
    private groupService: GroupService,
    private sidePanelRef: SidePanelRef,
    @Inject(SIDE_PANEL_DATA) public data: GroupSelectorPanelData
  ) {
    this.selectedGroupIds = [...(data.selectedGroupIds || [])];
  }

  ngOnInit(): void {
    this.loadGroups();
  }

  loadGroups(): void {
    this.groupService.getGroups().subscribe({
      next: (groups) => {
        this.availableGroups = groups;
      },
      error: (error) => {
        console.error('Error loading groups:', error);
      }
    });
  }

  isGroupSelected(groupId: number): boolean {
    return this.selectedGroupIds.includes(groupId);
  }

  toggleGroup(groupId: number): void {
    const index = this.selectedGroupIds.indexOf(groupId);
    if (index > -1) {
      this.selectedGroupIds.splice(index, 1);
    } else {
      this.selectedGroupIds.push(groupId);
    }
  }

  clearAll(): void {
    this.selectedGroupIds = [];
  }

  apply(): void {
    this.sidePanelRef.close(this.selectedGroupIds);
  }

  close(): void {
    this.sidePanelRef.close();
  }
}
```

### Key differences from the old version
- **Removed**: `@Input() isOpen`, `@Output() groupSelectionChange`, `@Output() closeSidebar`
- **Removed**: `.sidebar-backdrop` and `.sidebar` wrapper divs with `position: fixed` CSS
- **Added**: `:host { display: flex; flex-direction: column; height: 100%; }` — the CDK Overlay panel provides the outer container
- **Added**: `SidePanelRef` injection for closing, `SIDE_PANEL_DATA` injection for receiving data
- **Changed**: `toggleGroup()` now modifies local state instead of emitting events. The final selection is returned via `sidePanelRef.close(result)` when "Apply Selection" is clicked
- **Kept**: All the same template content and styles (header, checkbox list, actions bar)

---

### File 2: Update the parent component

**File**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/users/create-user.component.ts`

Make the following changes:

#### Edit 1: Add SidePanelService import (near line 22)

**Find:**
```typescript
import { GroupSelectorSidebarComponent } from './group-selector-sidebar/group-selector-sidebar.component';
```

**Replace with:**
```typescript
import { GroupSelectorSidebarComponent } from './group-selector-sidebar/group-selector-sidebar.component';
import { SidePanelService } from '../../shared/components/side-panel';
```

#### Edit 2: Remove GroupSelectorSidebarComponent from the imports array (near line 39)

**Find in the `imports` array:**
```typescript
    GroupSelectorSidebarComponent
```

**Remove this line** (the component is no longer embedded in the template — it's opened via the service).

#### Edit 3: Inject SidePanelService in the constructor

Find the constructor and add `SidePanelService`:

```typescript
private sidePanelService: SidePanelService
```

#### Edit 4: Remove the `<app-group-selector-sidebar>` element from the template

**Find and remove:**
```html
      <app-group-selector-sidebar
        [isOpen]="isGroupSelectorOpen"
        [selectedGroupIds]="selectedGroupIds"
        (groupSelectionChange)="onGroupSelectionChange($event)"
        (closeSidebar)="closeGroupSelector()">
      </app-group-selector-sidebar>
```

#### Edit 5: Update the method that opens the group selector

**Find the method that opens the group selector** (e.g., `openGroupSelector()` or similar) and replace it:

```typescript
openGroupSelector(): void {
  const ref = this.sidePanelService.open(GroupSelectorSidebarComponent, {
    data: { selectedGroupIds: [...this.selectedGroupIds] },
    width: '400px'
  });
  ref.afterClosed().subscribe(result => {
    if (result) {
      this.selectedGroupIds = result;
    }
  });
}
```

#### Edit 6: Remove the old `closeGroupSelector()` and `onGroupSelectionChange()` methods

These are no longer needed. The panel handles its own close and returns the result.

- Remove `closeGroupSelector()` method
- Remove `isGroupSelectorOpen` property
- Remove the `onGroupSelectionChange()` method if it only updates `selectedGroupIds`

---

## Acceptance Criteria

- [ ] `GroupSelectorSidebarComponent` no longer has `position: fixed` or z-index CSS
- [ ] `GroupSelectorSidebarComponent` no longer has `@Input() isOpen` or `@Output() closeSidebar`
- [ ] `GroupSelectorSidebarComponent` uses `SidePanelRef` and `SIDE_PANEL_DATA`
- [ ] `create-user.component.ts` opens the panel via `SidePanelService.open()`
- [ ] `create-user.component.ts` template does not contain `<app-group-selector-sidebar>`
- [ ] Group selection still works: open panel, check groups, click Apply, selections are preserved
- [ ] No compilation errors
