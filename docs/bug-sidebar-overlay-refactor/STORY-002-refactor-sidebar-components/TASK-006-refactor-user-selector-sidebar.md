# TASK-006: Refactor user-selector-sidebar + generic-selector-sidebar → UserSelectorPanelComponent

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-006 |
| **Status** | Open |
| **Story** | STORY-002: Refactor Sidebar Components to Use SidePanelService |
| **Description** | Refactor `user-selector-sidebar.component.ts` and `generic-selector-sidebar.component.ts` to use CDK Overlay, and update `groups.component.ts` |
| **Estimated Effort** | 35 minutes |
| **Dependencies** | STORY-001 must be completed first |

---

## Context

`UserSelectorSidebarComponent` wraps `GenericSelectorSidebarComponent`, which is a reusable generic sidebar. The user-selector converts `User[]` into `SelectorItem[]` and passes config options. The generic sidebar handles the display and selection.

Since the generic sidebar is used **only** by the user-selector in the current codebase, both components should be refactored together. The generic sidebar's `position: fixed` CSS is in `generic-selector-sidebar.component.scss`.

**Approach**: Merge them into a single panel component that directly renders the user list. This simplifies the code since the "generic" aspect isn't being reused.

---

## Files to Modify

### File 1: Refactor user-selector-sidebar

**File**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/groups/user-selector-sidebar/user-selector-sidebar.component.ts`

Replace the entire file:

```typescript
import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { User } from '../../../models/user.model';
import { Group } from '../../../models/group.model';
import { SidePanelRef, SIDE_PANEL_DATA } from '../../../shared/components/side-panel';

export interface UserSelectorPanelData {
  group: Group;
  availableUsers: User[];
}

@Component({
  selector: 'app-user-selector-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule
  ],
  template: `
    <div class="sidebar-header">
      <div class="header-content">
        <h2>Add Member to Group</h2>
        <p class="subtitle" *ngIf="group">Select a user to add to "{{ group.name }}"</p>
      </div>
      <button mat-icon-button (click)="close()">
        <mat-icon>close</mat-icon>
      </button>
    </div>
    
    <mat-divider></mat-divider>
    
    <div class="item-list-container">
      <mat-nav-list>
        <a mat-list-item *ngFor="let user of availableUsers" 
           (click)="selectUser(user)"
           class="selector-item">
          <mat-icon matListItemIcon>person</mat-icon>
          <div matListItemTitle>{{ (user.firstName || '') + ' ' + (user.lastName || '') | trim }}</div>
          <div matListItemLine class="item-email">{{ user.email }}</div>
        </a>
      </mat-nav-list>
      
      <div *ngIf="availableUsers.length === 0" class="no-items-message">
        <mat-icon>person_off</mat-icon>
        <p>No available users to add to this group</p>
      </div>
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
      align-items: flex-start;
      padding: 24px;
      background-color: var(--mdc-theme-primary);
      color: var(--mdc-theme-on-primary);
    }

    .header-content {
      flex: 1;
    }

    .header-content h2 {
      margin: 0 0 8px 0;
      font-size: 1.5rem;
      font-weight: 500;
    }

    .subtitle {
      margin: 0;
      opacity: 0.9;
      font-size: 0.9rem;
    }

    .item-list-container {
      flex: 1;
      overflow-y: auto;
    }

    .selector-item {
      cursor: pointer;
    }

    .item-email {
      font-size: 0.85rem;
      color: #666;
    }

    .no-items-message {
      text-align: center;
      padding: 48px 24px;
      color: rgba(0, 0, 0, 0.54);
    }

    .no-items-message mat-icon {
      font-size: 48px;
      height: 48px;
      width: 48px;
      margin-bottom: 16px;
    }

    .no-items-message p {
      margin: 0;
      font-size: 16px;
    }
  `]
})
export class UserSelectorSidebarComponent implements OnInit {
  group: Group;
  availableUsers: User[];

  constructor(
    private sidePanelRef: SidePanelRef,
    @Inject(SIDE_PANEL_DATA) public panelData: UserSelectorPanelData
  ) {
    this.group = panelData.group;
    this.availableUsers = panelData.availableUsers;
  }

  ngOnInit(): void {}

  selectUser(user: User): void {
    this.sidePanelRef.close({ user, group: this.group });
  }

  close(): void {
    this.sidePanelRef.close();
  }
}
```

> **Note**: The template uses a `| trim` pipe on the user name. If the `trim` pipe doesn't exist in the project, replace `{{ (user.firstName || '') + ' ' + (user.lastName || '') | trim }}` with `{{ ((user.firstName || '') + ' ' + (user.lastName || '')).trim() }}` or just `{{ user.firstName }} {{ user.lastName }}`.

---

### File 2: Update groups.component.ts

**File**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/features/groups/groups.component.ts`

1. **Remove** `UserSelectorSidebarComponent` from the `imports` array
2. **Remove** `<app-user-selector-sidebar>` from the template (lines 97-104)
3. **Update** `addMember()`:
   ```typescript
   addMember(group: Group): void {
     // Load available users, then open the panel
     this.userService.getUsers().subscribe({
       next: (users) => {
         const memberIds = group.users?.map(user => user.id) || [];
         const availableUsers = users.filter(user => !memberIds.includes(user.id));
         
         const ref = this.sidePanelService.open(UserSelectorSidebarComponent, {
           data: { group, availableUsers },
           width: '400px'
         });
         ref.afterClosed().subscribe(result => {
           if (result) {
             this.onUserSelected(result);
           }
         });
       },
       error: (error) => {
         console.error('Error loading available users:', error);
         this.snackBar.open('Error loading available users', 'Close', { duration: 3000 });
       }
     });
   }
   ```
4. **Remove**: `isUserSelectorOpen`, `selectedGroupForUser`, `availableUsers`, `closeUserSelector()`, `loadAvailableUsers()`. Keep `onUserSelected()`.

---

## Acceptance Criteria

- [ ] `UserSelectorSidebarComponent` no longer uses `GenericSelectorSidebarComponent`
- [ ] `UserSelectorSidebarComponent` uses `SidePanelRef` and `SIDE_PANEL_DATA`
- [ ] `groups.component.ts` opens the panel via `SidePanelService.open()`
- [ ] Clicking a user returns `{ user, group }` to the parent
- [ ] No compilation errors
