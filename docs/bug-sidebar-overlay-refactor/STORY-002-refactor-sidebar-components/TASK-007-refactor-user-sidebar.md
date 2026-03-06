# TASK-007: Refactor user-sidebar → UserProfilePanelComponent

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-007 |
| **Status** | Open |
| **Story** | STORY-002: Refactor Sidebar Components to Use SidePanelService |
| **Description** | Refactor `user-sidebar.component.ts` (layout-level profile sidebar) to be opened via `SidePanelService`, and update `custom-layout.component.ts` |
| **Estimated Effort** | 30 minutes |
| **Dependencies** | STORY-001 must be completed first |

---

## Context

`UserSidebarComponent` is the user profile menu in the header (Profile, Account Settings, Change Password, Logout). It's currently rendered outside `mat-sidenav-content` in `custom-layout.component.ts`, so it doesn't have the stacking context issue — but it has a **focus management issue** because it uses raw CSS without CDK focus trapping.

After refactoring: CDK Overlay provides automatic focus trapping, backdrop handling, and Escape key support.

---

## Files to Modify

### File 1: Refactor user-sidebar.component.ts

**File**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/layouts/user-sidebar/user-sidebar.component.ts`

Replace the entire file:

```typescript
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { Store } from '@ngxs/store';
import { AuthActions } from '../../store/auth/auth.state';
import { User } from '../../models';
import { LoggerService } from '../../services/logging/logger.service';
import { AuthService } from '../../core/services/auth.service';
import { Observable } from 'rxjs';
import { SidePanelRef } from '../../shared/components/side-panel';

@Component({
  selector: 'app-user-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule
  ],
  template: `
    <div class="sidebar-header">
      <div class="user-info">
        <mat-icon class="user-avatar">account_circle</mat-icon>
        <div class="user-details">
          <h3>{{ getDisplayName(currentUser$ | async) }}</h3>
          <p class="user-email">{{ (currentUser$ | async)?.email }}</p>
        </div>
      </div>
      <button mat-icon-button (click)="close()">
        <mat-icon>close</mat-icon>
      </button>
    </div>
    
    <mat-divider></mat-divider>
    
    <mat-nav-list>
      <a mat-list-item (click)="navigateToProfile()">
        <mat-icon matListItemIcon>person</mat-icon>
        <span matListItemTitle>Profile</span>
      </a>
      
      <a mat-list-item (click)="navigateToSettings()">
        <mat-icon matListItemIcon>settings</mat-icon>
        <span matListItemTitle>Account Settings</span>
      </a>
      
      <a mat-list-item (click)="navigateToChangePassword()">
        <mat-icon matListItemIcon>lock</mat-icon>
        <span matListItemTitle>Change Password</span>
      </a>
      
      <mat-divider></mat-divider>
      
      <a mat-list-item (click)="logout()">
        <mat-icon matListItemIcon>logout</mat-icon>
        <span matListItemTitle>Logout</span>
      </a>
    </mat-nav-list>
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
      padding: 20px;
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .user-avatar {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: var(--mdc-theme-primary);
    }

    .user-details h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 500;
    }

    .user-email {
      margin: 4px 0 0;
      font-size: 13px;
      color: #666;
    }
  `]
})
export class UserSidebarComponent implements OnInit, OnDestroy {
  currentUser$: Observable<User | null>;
  
  constructor(
    private store: Store,
    private router: Router,
    private logger: LoggerService,
    private authService: AuthService,
    private sidePanelRef: SidePanelRef
  ) {
    this.currentUser$ = this.authService.currentUser$;
  }
  
  ngOnInit(): void {}
  
  ngOnDestroy(): void {}
  
  close(): void {
    this.sidePanelRef.close();
  }
  
  navigateToProfile(): void {
    this.router.navigate(['/app/profile']);
    this.close();
  }
  
  navigateToSettings(): void {
    this.router.navigate(['/app/settings']);
    this.close();
  }
  
  navigateToChangePassword(): void {
    this.router.navigate(['/app/profile/change-password']);
    this.close();
  }
  
  logout(): void {
    this.store.dispatch(new AuthActions.Logout()).subscribe({
      next: () => {
        this.router.navigate(['/login']);
      },
      error: (error) => {
        this.logger.error('Error during logout:', error);
        this.router.navigate(['/login']);
      }
    });
  }
  
  getDisplayName(user: User | null): string {
    if (!user) return '';
    if (user.firstName || user.lastName) {
      return `${user.firstName || ''} ${user.lastName || ''}`.trim();
    }
    return user.email;
  }
}
```

### Key changes
- **Removed**: `@Input() isOpen`, `@Input() currentUser`, `@Output() closeSidebar`
- **Removed**: `.user-sidebar` and `.sidebar-backdrop` wrapper divs with `position: fixed` CSS
- **Added**: `SidePanelRef` injection for closing
- **Kept**: Same template content, navigation methods, and user display logic

---

### File 2: Update custom-layout.component.ts

**File**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/layouts/custom-layout/custom-layout.component.ts`

1. **Add import**:
   ```typescript
   import { SidePanelService } from '../../shared/components/side-panel';
   ```

2. **Remove** `UserSidebarComponent` from the `imports` array

3. **Remove** the `<app-user-sidebar>` element from the template (it's outside the grid layout div, near the end of the template)

4. **Inject** `SidePanelService` in the constructor

5. **Update** `openUserSidebar()`:
   ```typescript
   openUserSidebar(): void {
     this.sidePanelService.open(UserSidebarComponent, {
       width: '320px'
     });
   }
   ```
   Note: No data needs to be passed — the component gets user data from `AuthService` directly.

6. **Remove**: `isUserSidebarOpen`, `closeUserSidebar()`, `currentUser` property (if only used for the sidebar)

---

## Acceptance Criteria

- [ ] `UserSidebarComponent` no longer has `position: fixed` or z-index CSS
- [ ] `UserSidebarComponent` uses `SidePanelRef` for closing
- [ ] Focus is properly trapped inside the panel when open
- [ ] Clicking backdrop closes the panel
- [ ] Escape key closes the panel
- [ ] Navigation links and Logout still work
- [ ] `custom-layout.component.ts` template does not contain `<app-user-sidebar>`
- [ ] No compilation errors
