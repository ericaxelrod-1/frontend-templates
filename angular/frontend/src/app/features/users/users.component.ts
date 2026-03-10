import { Component, OnInit, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UserService, UpdateUserRequest } from '../../services/user.service';
import { GroupService } from '../../services/group.service';
import { PageTitleService } from '../../core/services/page-title.service';
import { RoleService } from '../../services/role.service';
import { AuthService } from '../../core/services/auth.service';
import { Router } from '@angular/router';
import { forkJoin, of, catchError, mergeMap, map } from 'rxjs';
import { LoggerService } from '../../services/logging/logger.service';
import { PermissionService } from '../../core/services/permission.service';
import { User } from '../../models/user.model';
import { Group } from '../../models/group.model';
import { Role } from '../../services/role.service';
import { PermissionsModule } from '../../shared/modules/permissions.module';
import { GroupSelectorSidebarComponent } from './group-selector-sidebar/group-selector-sidebar.component';
import { RoleSelectorSidebarComponent } from './role-selector-sidebar/role-selector-sidebar.component';
import { SidePanelService } from '../../shared/components/side-panel';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    PermissionsModule
  ],
  template: `
    <div class="users-container">
      
      <div *ngIf="loading" class="loading">
        Loading users...
      </div>
      
      <ng-container *ngIf="!loading">
        <div class="actions-bar" *hasPermission="'users:create'">
          <button mat-raised-button color="primary" (click)="createUser()">
            <mat-icon>add</mat-icon> Add User
          </button>
        </div>
        
        <div *ngIf="users.length === 0" class="empty-state">
          No users found. Please try again later.
        </div>
        
        <table *ngIf="users.length > 0" mat-table [dataSource]="users" class="users-table">
          <!-- ID Column -->
          <ng-container matColumnDef="id">
            <th mat-header-cell *matHeaderCellDef>ID</th>
            <td mat-cell *matCellDef="let user">{{ user.id }}</td>
          </ng-container>
          
          <!-- Name Column -->
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Name</th>
            <td mat-cell *matCellDef="let user">{{ getDisplayName(user) || 'Unknown' }}</td>
          </ng-container>
          
          <!-- Email Column -->
          <ng-container matColumnDef="email">
            <th mat-header-cell *matHeaderCellDef>Email</th>
            <td mat-cell *matCellDef="let user">{{ user.email || 'No email available' }}</td>
          </ng-container>
          
          <!-- Role Column -->
          <ng-container matColumnDef="role">
            <th mat-header-cell *matHeaderCellDef>Roles</th>
            <td mat-cell *matCellDef="let user">
              <div *ngIf="!user.roles || user.roles.length === 0" class="no-roles">
                No roles
              </div>
              <mat-chip-listbox *ngIf="user.roles && user.roles.length > 0">
                <ng-container *ngFor="let role of user.roles">
                  <mat-chip *ngIf="role">
                    {{ role.name }}
                    <button *ngIf="canManageRoles(user)" matChipRemove (click)="removeFromRole(user, role)">
                      <mat-icon>cancel</mat-icon>
                    </button>
                  </mat-chip>
                </ng-container>
              </mat-chip-listbox>
              
              <button *ngIf="canManageRoles(user) && getAvailableRolesForUser(user).length > 0"
                      mat-raised-button
                      color="accent"
                      class="add-role-button"
                      (click)="openRoleSelector(user)"
                      style="z-index: 10; position: relative;">
                <mat-icon>add</mat-icon>
                Add to role
              </button>
            </td>
          </ng-container>

          <!-- Groups Column -->
          <ng-container matColumnDef="groups">
            <th mat-header-cell *matHeaderCellDef>Groups</th>
            <td mat-cell *matCellDef="let user">
              <div *ngIf="!user.groups || user.groups.length === 0" class="no-groups">
                No groups
              </div>
              <mat-chip-listbox *ngIf="user.groups && user.groups.length > 0">
                <ng-container *ngFor="let group of user.groups">
                  <mat-chip *ngIf="group">
                    {{ group.name }}
                    <button *ngIf="canManageGroups(user)" matChipRemove (click)="removeFromGroup(user, group)">
                      <mat-icon>cancel</mat-icon>
                    </button>
                  </mat-chip>
                </ng-container>
              </mat-chip-listbox>
              
              <button *ngIf="canManageGroups(user) && getAvailableGroupsForUser(user).length > 0"
                      mat-raised-button
                      color="primary"
                      class="add-group-button"
                      (click)="openGroupSelector(user)"
                      style="z-index: 10; position: relative;">
                <mat-icon>add</mat-icon>
                Add to group
              </button>
            </td>
          </ng-container>
          
          <!-- Actions Column -->
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef>Actions</th>
            <td mat-cell *matCellDef="let user">
              <button *hasPermission="'users:update'" mat-icon-button color="primary" (click)="editUser(user)">
                <mat-icon>edit</mat-icon>
              </button>
              <button *hasPermission="'users:delete'" mat-icon-button color="warn" (click)="deleteUser(user)">
                <mat-icon>delete</mat-icon>
              </button>
            </td>
          </ng-container>
          
          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
        </table>
      </ng-container>
    </div>
  `,
  styles: [`
    .users-container {
      padding: 20px;
    }
    
    .actions-bar {
      margin-bottom: 20px;
    }
    
    .users-table {
      width: 100%;
    }
    
    .mat-column-actions {
      width: 100px;
    }

    .mat-column-groups {
      min-width: 300px;
    }

    .mat-column-role {
      min-width: 300px;
    }
    
    .mat-chip-listbox {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-right: 8px;
      vertical-align: middle;
    }

    .add-group-button, .add-role-button {
      display: inline-block;
      margin-left: 8px;
      vertical-align: middle;
      position: relative;
      z-index: 10;
      pointer-events: auto;
      
      mat-icon {
        margin-right: 4px;
      }
    }

    .add-group-button:not([disabled]), .add-role-button:not([disabled]) {
      cursor: pointer;
    }

    .add-group-button[disabled], .add-role-button[disabled] {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .permission-error {
      text-align: center;
      padding: 20px;
      background-color: #f5f5f5;
      border-radius: 4px;
      margin: 20px 0;
    }

    .loading, .empty-state {
      text-align: center;
      padding: 20px;
    }
    
    .no-groups, .no-roles {
      font-style: italic;
      color: #666;
    }
  `]
})
export class UsersComponent implements OnInit {
  displayedColumns: string[] = ['id', 'name', 'email', 'role', 'groups', 'actions'];
  users: User[] = [];
  availableGroups: Group[] = [];
  availableRoles: Role[] = [];
  loading = true;
  currentUserGroups: Group[] = [];
  currentUser: User | null = null;
  hasManageUsersPermission = false;
  hasManageGroupsPermission = false;
  hasManageRolesPermission = false;

  // Group selector sidebar state
  isGroupSelectorOpen = false;
  selectedUserForGroup: User | null = null;
  originalGroupIds: number[] = []; // Track original group memberships for change detection

  // Role selector state
  isRoleSelectorOpen = false;
  selectedUserForRole: User | null = null;

  constructor(
    private userService: UserService,
    private groupService: GroupService,
    private roleService: RoleService,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private router: Router,
    private logger: LoggerService,
    private permissionService: PermissionService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private sidePanelService: SidePanelService,
    private pageTitleService: PageTitleService
  ) { }

  ngOnInit(): void {
    this.pageTitleService.setTitle('Users');
    this.loadData();
  }

  // Method to convert auth user to our User model
  private convertAuthUserToUserModel(authUser: any): User {
    return {
      id: authUser.id,
      email: authUser.email,
      firstName: authUser.firstName,
      lastName: authUser.lastName,
      isActive: authUser.isActive,
      isVerified: authUser.isVerified,
      permissions: authUser.permissions || [],
      roles: authUser.roles || [],
      groups: authUser.groups || []
    };
  }

  // Property to check if current user can manage users
  get canManageUsers(): boolean {
    return this.hasManageUsersPermission;
  }

  // Check if the current user can manage groups for a given user
  canManageGroups(user: User): boolean {
    // Use both async loaded permission and sync check as fallback
    const hasAsyncPermission = this.hasManageGroupsPermission;
    const hasSyncPermission = this.permissionService.hasPermissionSync('groups:manage');
    const hasPermission = hasAsyncPermission || hasSyncPermission;

    // Don't allow users to manage their own groups
    const isNotSelf = user.id !== this.currentUser?.id;

    return hasPermission && isNotSelf;
  }

  loadData(): void {
    this.loading = true;

    // Load permissions first
    forkJoin({
      manageUsers: this.permissionService.hasPermission('users:update'),
      manageGroups: this.permissionService.hasPermission('groups:manage'),
      manageRoles: this.permissionService.hasPermission('roles:assign')
    }).subscribe({
      next: (permissions) => {
        this.hasManageUsersPermission = permissions.manageUsers;
        this.hasManageGroupsPermission = permissions.manageGroups;
        this.hasManageRolesPermission = permissions.manageRoles;

        // Load data - get current user synchronously and load other data
        this.currentUser = this.authService.currentUser;

        forkJoin({
          users: this.userService.getUsers(),
          groups: this.groupService.getGroups(),
          roles: this.roleService.getRoles()
        }).subscribe({
          next: (data) => {
            this.users = data.users;
            this.availableGroups = data.groups.items;
            this.availableRoles = data.roles.items;
            this.loading = false;
            this.cdr.detectChanges();
          },
          error: (error) => {
            this.logger.error('Error loading data:', error);
            this.loading = false;
            this.snackBar.open('Error loading data. Please try again.', 'Close', {
              duration: 5000
            });
          }
        });
      },
      error: (error) => {
        this.logger.error('Error checking permissions:', error);
        this.loading = false;
      }
    });
  }

  // Load user's groups if not included in profile
  loadUserGroups(): void {
    if (!this.currentUser) {
      return;
    }

    this.groupService.getGroups().subscribe({
      next: (response) => {
        this.currentUserGroups = response.items.map(group => ({
          ...group,
          permissions: group.permissions || []
        }));
        this.availableGroups = this.currentUserGroups;
        this.loadGroupMembers();
      },
      error: (error) => {
        this.logger.error('Error loading user groups:', error);
        this.snackBar.open('Error loading user groups', 'Close', { duration: 3000 });
      }
    });
  }

  // Load members from user's groups
  loadGroupMembers(): void {
    if (!this.currentUser || !this.currentUserGroups.length) {
      return;
    }

    const groupMemberRequests = this.currentUserGroups.map(group =>
      this.groupService.getGroupMembers(group.id).pipe(
        map(members => ({
          ...group,
          members: members.map(member => ({
            ...member,
            permissions: member.permissions || []
          }))
        })),
        catchError(error => {
          this.logger.error(`Error loading members for group ${group.id}:`, error);
          return of({
            ...group,
            members: []
          });
        })
      )
    );

    forkJoin(groupMemberRequests).subscribe({
      next: (updatedGroups) => {
        this.currentUserGroups = updatedGroups;
      },
      error: (error) => {
        this.logger.error('Error loading group members:', error);
        this.snackBar.open('Error loading group members', 'Close', { duration: 3000 });
      }
    });
  }

  createUser(): void {
    // Check permission before navigating
    if (this.permissionService.hasPermissionSync('users:create')) {
      this.ngZone.run(() => {
        this.router.navigate(['/app/users/create']);
      });
    }
  }

  editUser(user: User): void {
    this.ngZone.run(() => {
      this.router.navigate(['/app/users', user.id, 'edit']);
    });
  }

  deleteUser(user: User): void {
    if (confirm(`Are you sure you want to delete ${user.firstName || user.email}?`)) {
      this.userService.deleteUser(user.id).subscribe({
        next: () => {
          this.users = this.users.filter(u => u.id !== user.id);
          this.snackBar.open('User deleted successfully', 'Close', { duration: 3000 });
        },
        error: (error) => {
          this.logger.error('Error deleting user:', error);
          this.snackBar.open('Error deleting user', 'Close', { duration: 3000 });
        }
      });
    }
  }

  // Get list of available groups for a user (groups they're not already in)
  getAvailableGroupsForUser(user: User): Group[] {
    const userGroups = user.groups || [];
    return this.availableGroups.filter(group =>
      !userGroups.some(userGroup => userGroup.id === group.id)
    );
  }

  addToGroup(user: User, group: Group): void {
    if (!group.id) {
      this.logger.error('Cannot add user to group: group.id is undefined', { group });
      return;
    }

    // Use incremental API endpoint with meaningful response handling
    this.userService.addUserToGroup(user.id, group.id).subscribe({
      next: (result) => {
        this.logger.debug('Group membership operation completed', {
          success: result.success,
          operation: result.operation,
          message: result.message,
          userId: result.user.id,
          groupName: result.group.name
        });

        if (result.success) {
          // Fetch fresh user data to update the UI
          this.userService.getUser(user.id).subscribe({
            next: (updatedUser) => {
              // Update the user in the local array
              const index = this.users.findIndex(u => u.id === user.id);
              if (index !== -1) {
                this.users[index] = updatedUser;
                // Force change detection by creating a new array reference
                this.users = [...this.users];
              }
              this.snackBar.open(result.message, 'Close', {
                duration: 3000
              });
              this.cdr.detectChanges();
            },
            error: (error) => {
              this.logger.error('Error fetching updated user data:', error);
              // Still show success message since the operation succeeded
              this.snackBar.open(result.message, 'Close', {
                duration: 3000
              });
            }
          });
        } else {
          // Operation failed but didn't throw an error (e.g., user already in group)
          this.snackBar.open(result.message, 'Close', {
            duration: 4000
          });
        }
      },
      error: (error) => {
        this.logger.error('Error adding user to group:', error);
        this.snackBar.open(error.message || 'Error adding user to group', 'Close', {
          duration: 5000
        });
      }
    });
  }

  removeFromGroup(user: User, group: Group): void {
    if (!group.id) {
      this.logger.error('Cannot remove user from group: missing group ID', {
        groupId: group.id
      });
      return;
    }

    // Use incremental API endpoint with meaningful response handling
    this.userService.removeUserFromGroup(user.id, group.id).subscribe({
      next: (result) => {
        this.logger.debug('Group membership operation completed', {
          success: result.success,
          operation: result.operation,
          message: result.message,
          userId: result.user.id,
          groupName: result.group.name
        });

        if (result.success) {
          // Fetch fresh user data to update the UI
          this.userService.getUser(user.id).subscribe({
            next: (updatedUser) => {
              // Update the user in the local array
              const index = this.users.findIndex(u => u.id === user.id);
              if (index !== -1) {
                this.users[index] = updatedUser;
                // Force change detection by creating a new array reference
                this.users = [...this.users];
              }
              this.snackBar.open(result.message, 'Close', {
                duration: 3000
              });
              this.cdr.detectChanges();
            },
            error: (error) => {
              this.logger.error('Error fetching updated user data:', error);
              // Still show success message since the operation succeeded
              this.snackBar.open(result.message, 'Close', {
                duration: 3000
              });
            }
          });
        } else {
          // Operation failed but didn't throw an error (e.g., user not in group)
          this.snackBar.open(result.message, 'Close', {
            duration: 4000
          });
        }
      },
      error: (error) => {
        this.logger.error('Error removing user from group:', error);
        this.snackBar.open(error.message || 'Error removing user from group', 'Close', {
          duration: 5000
        });
      }
    });
  }

  canEditUsers(): boolean {
    return this.permissionService.hasPermissionSync('users:update');
  }

  trackByGroupId(index: number, group: Group): number {
    return group.id;
  }

  openGroupSelector(user: User): void {
    // Fetch fresh user data to ensure we have current group memberships
    this.userService.getUser(user.id).subscribe({
      next: (freshUser) => {
        this.selectedUserForGroup = freshUser;
        // Store original group IDs as baseline for change detection
        this.originalGroupIds = freshUser.groups?.map(g => g.id).filter((id): id is number => id !== undefined) || [];

        this.logger.debug('Opened group selector with fresh user data', {
          userId: freshUser.id,
          currentGroups: this.originalGroupIds,
          groupNames: freshUser.groups?.map(g => g.name) || []
        });

        const ref = this.sidePanelService.open(GroupSelectorSidebarComponent, {
          data: { selectedGroupIds: [...this.originalGroupIds] },
          width: '400px'
        });
        ref.afterClosed().subscribe(result => {
          if (result) {
            this.onGroupSelectionChange(result);
          }
        });
      },
      error: (error) => {
        this.logger.error('Error fetching fresh user data for group selector:', error);
        this.snackBar.open('Error loading user data. Please refresh and try again.', 'Close', {
          duration: 5000
        });
      }
    });
  }

  closeGroupSelector(): void {
    this.isGroupSelectorOpen = false;
    this.selectedUserForGroup = null;
  }

  onGroupSelectionChange(groupIds: number[]): void {
    if (!this.selectedUserForGroup) {
      return;
    }

    // Calculate changes from the original baseline
    const addedGroupIds = groupIds.filter(groupId => !this.originalGroupIds.includes(groupId));
    const removedGroupIds = this.originalGroupIds.filter(groupId => !groupIds.includes(groupId));

    this.logger.debug('Group selection change detected', {
      userId: this.selectedUserForGroup.id,
      originalGroups: this.originalGroupIds,
      selectedGroups: groupIds,
      addedGroups: addedGroupIds,
      removedGroups: removedGroupIds
    });

    // Process additions
    if (addedGroupIds.length > 0) {
      addedGroupIds.forEach(groupId => {
        const group = this.availableGroups.find(g => g.id === groupId);
        if (group) {
          this.addToGroup(this.selectedUserForGroup!, group);
        }
      });
    }

    // Process removals
    if (removedGroupIds.length > 0) {
      removedGroupIds.forEach(groupId => {
        const group = this.availableGroups.find(g => g.id === groupId);
        if (group) {
          this.removeFromGroup(this.selectedUserForGroup!, group);
        }
      });
    }

    // If no changes were made, inform the user
    if (addedGroupIds.length === 0 && removedGroupIds.length === 0) {
      this.snackBar.open('No changes made to group memberships', 'Close', { duration: 3000 });
    }

    // Close the selector after processing
    this.closeGroupSelector();
  }

  getDisplayName(user: User | null): string {
    if (!user) return '';
    if (user.firstName || user.lastName) {
      return `${user.firstName || ''} ${user.lastName || ''}`.trim();
    }
    return user.email || 'Unknown';
  }

  canManageRoles(user: User): boolean {
    // Check if current user has permission to manage roles
    if (!this.hasManageRolesPermission) {
      return false;
    }

    // Additional business logic can be added here
    // For example, prevent managing roles of superadmins
    return true;
  }

  getAvailableRolesForUser(user: User): Role[] {
    if (!user.roles) {
      return this.availableRoles;
    }

    const userRoleIds = user.roles.map(role => role.id).filter((id): id is number => id !== undefined);
    return this.availableRoles.filter(role => role.id && !userRoleIds.includes(role.id));
  }

  addToRole(user: User, role: Role): void {
    if (!role.id) return;

    this.userService.addUserToRole(user.id, role.id).subscribe({
      next: (result) => {
        if (result.success) {
          // Update the user in the local array with fresh data
          this.userService.getUser(user.id).subscribe({
            next: (updatedUser) => {
              const index = this.users.findIndex(u => u.id === user.id);
              if (index !== -1) {
                this.users[index] = updatedUser;
                // Force change detection by creating a new array reference
                this.users = [...this.users];
              }
              this.cdr.detectChanges();
            }
          });

          this.snackBar.open(result.message, 'Close', {
            duration: 3000
          });
        } else {
          // Graceful failure - user already has role
          this.snackBar.open(result.message, 'Close', {
            duration: 3000
          });
        }
      },
      error: (error) => {
        this.logger.error('Error adding user to role:', error);
        this.snackBar.open(error.message || 'Error adding user to role', 'Close', {
          duration: 5000
        });
      }
    });
  }

  removeFromRole(user: User, role: Role): void {
    if (!role.id) return;

    this.userService.removeUserFromRole(user.id, role.id).subscribe({
      next: (result) => {
        if (result.success) {
          // Update the user in the local array with fresh data
          this.userService.getUser(user.id).subscribe({
            next: (updatedUser) => {
              const index = this.users.findIndex(u => u.id === user.id);
              if (index !== -1) {
                this.users[index] = updatedUser;
                // Force change detection by creating a new array reference
                this.users = [...this.users];
              }
              this.cdr.detectChanges();
            }
          });

          this.snackBar.open(result.message, 'Close', {
            duration: 3000
          });
        } else {
          // Graceful failure - user doesn't have role
          this.snackBar.open(result.message, 'Close', {
            duration: 3000
          });
        }
      },
      error: (error) => {
        this.logger.error('Error removing user from role:', error);
        this.snackBar.open(error.message || 'Error removing user from role', 'Close', {
          duration: 5000
        });
      }
    });
  }

  openRoleSelector(user: User): void {
    this.selectedUserForRole = user;
    const selectedRoleIds = user.roles?.map(r => r.id).filter((id): id is number => id !== undefined) || [];

    const ref = this.sidePanelService.open(RoleSelectorSidebarComponent, {
      data: { selectedRoleIds: [...selectedRoleIds] },
      width: '400px'
    });
    ref.afterClosed().subscribe(result => {
      if (result) {
        this.onRoleSelectionChange(result);
      }
    });
  }

  closeRoleSelector(): void {
    this.isRoleSelectorOpen = false;
    this.selectedUserForRole = null;
  }

  onRoleSelectionChange(selectedRoleIds: number[]): void {
    if (!this.selectedUserForRole) return;

    const user = this.selectedUserForRole;
    const currentRoleIds = user.roles?.map(r => r.id).filter((id): id is number => id !== undefined) || [];

    // Calculate which roles to add and which to remove
    const addedRoleIds = selectedRoleIds.filter(roleId => !currentRoleIds.includes(roleId));
    const removedRoleIds = currentRoleIds.filter(roleId => !selectedRoleIds.includes(roleId));

    // Process additions using dedicated endpoints
    if (addedRoleIds.length > 0) {
      addedRoleIds.forEach(roleId => {
        const role = this.availableRoles.find(r => r.id === roleId);
        if (role) {
          this.addToRole(this.selectedUserForRole!, role);
        }
      });
    }

    // Process removals using dedicated endpoints
    if (removedRoleIds.length > 0) {
      removedRoleIds.forEach(roleId => {
        const role = this.availableRoles.find(r => r.id === roleId);
        if (role) {
          this.removeFromRole(this.selectedUserForRole!, role);
        }
      });
    }

    // If no changes were made, inform the user
    if (addedRoleIds.length === 0 && removedRoleIds.length === 0) {
      this.snackBar.open('No changes made to role memberships', 'Close', { duration: 3000 });
    }

    // Close the selector after processing
    this.closeRoleSelector();
  }

  getSelectedGroupIds(): number[] {
    // Return current group memberships for visual feedback
    if (!this.selectedUserForGroup?.groups) {
      return [];
    }
    return this.selectedUserForGroup.groups
      .map(g => g.id)
      .filter((id): id is number => id !== undefined);
  }

  getSelectedRoleIds(): number[] {
    if (!this.selectedUserForRole?.roles) {
      return [];
    }
    return this.selectedUserForRole.roles
      .map(r => r.id)
      .filter((id): id is number => id !== undefined);
  }

}
