import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { GroupService } from '../../services/group.service';
import { UserService } from '../../services/user.service';
import { Group, Permission, GROUP_PERMISSION_SETS } from '../../models/group.model';
import { User } from '../../models/user.model';
import { UserSelectorSidebarComponent } from './user-selector-sidebar/user-selector-sidebar.component';
import { MemberActionsSidebarComponent, MemberAction } from './member-actions-sidebar/member-actions-sidebar.component';
import { GroupCreationSidebarComponent } from './group-creation-sidebar/group-creation-sidebar.component';
import { AuthService } from '../../core/services/auth.service';
import { Router } from '@angular/router';
import { PermissionService } from '../../core/services/permission.service';
import { SidePanelService } from '../../shared/components/side-panel';

@Component({
  selector: 'app-groups',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatListModule
  ],
  template: `
    <div class="groups-container">
      <h1>Groups</h1>
      
      <div *ngIf="!hasPermission" class="permission-error">
        <p>You do not have permission to view this page.</p>
        <button mat-raised-button color="primary" (click)="goToDashboard()">Go to Dashboard</button>
      </div>
      
      <ng-container *ngIf="hasPermission">
        <div class="actions-bar">
          <button mat-raised-button color="primary" (click)="createGroup()">
            <mat-icon>add</mat-icon> Create Group
          </button>
        </div>
        
        <div *ngIf="loading" class="loading">
          Loading groups...
        </div>
        
        <div class="groups-grid">
          <mat-card *ngFor="let group of groups" class="group-card">
            <mat-card-header>
              <mat-card-title>{{ group.name }}</mat-card-title>
              <mat-card-subtitle>Owner: {{ group.owner }}</mat-card-subtitle>
            </mat-card-header>
            
            <mat-card-content>
              <p>{{ group.description }}</p>
              
              <div class="members-section">
                <h3>Members ({{ group.users ? group.users.length : 0 }})</h3>
                <mat-list *ngIf="group.users && group.users.length > 0">
                  <mat-list-item *ngFor="let user of group.users">
                    <span matListItemTitle>{{ (user.firstName || '') + ' ' + (user.lastName || '') || user.email }}</span>
                    <span matListItemLine>{{ user.roles?.[0]?.name || 'Member' }}</span>
                    <button mat-icon-button (click)="openMemberActions(group, user)" matListItemMeta class="member-actions-button">
                      <mat-icon>more_vert</mat-icon>
                    </button>
                  </mat-list-item>
                </mat-list>
                <div *ngIf="!group.users || group.users.length === 0" class="no-members">
                  No members in this group.
                </div>
                
                <button mat-button color="primary" (click)="addMember(group)" class="add-member-button">
                  <mat-icon>person_add</mat-icon> Add Member
                </button>
              </div>
            </mat-card-content>
            
            <mat-card-actions>
              <button mat-button color="primary" (click)="editGroup(group)">
                <mat-icon>edit</mat-icon> Edit
              </button>
              <button mat-button color="warn" (click)="deleteGroup(group)">
                <mat-icon>delete</mat-icon> Delete
              </button>
            </mat-card-actions>
          </mat-card>
        </div>
      </ng-container>
      
    </div>
  `,
  styles: [`
    .groups-container {
      padding: 20px;
    }
    
    .actions-bar {
      margin-bottom: 20px;
    }
    
    .groups-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }
    
    .group-card {
      height: 100%;
    }
    
    .members-section {
      margin-top: 16px;
    }
    
    .members-section h3 {
      margin-bottom: 8px;
    }
    
    mat-list {
      max-height: 200px;
      overflow-y: auto;
    }
    
    .permission-error {
      text-align: center;
      padding: 20px;
      background-color: #f5f5f5;
      border-radius: 4px;
      margin: 20px 0;
    }
    
    .loading {
      text-align: center;
      padding: 20px;
    }
    
    .no-members {
      font-style: italic;
      color: #666;
      margin: 16px 0;
    }
    
    .add-member-button {
    }
    
    .member-actions-button {
    }
  `]
})
export class GroupsComponent implements OnInit {
  groups: Group[] = [];
  hasPermission = false;
  loading = true;

  constructor(
    private groupService: GroupService,
    private userService: UserService,
    private snackBar: MatSnackBar,
    private authService: AuthService,
    private router: Router,
    private permissionService: PermissionService,
    private sidePanelService: SidePanelService
  ) { }

  ngOnInit(): void {
    // Check permission to view groups using resource:action format
    this.permissionService.hasPermission('groups:view').subscribe(hasPermission => {
      console.log('[GroupsComponent] Permission check result:', hasPermission);
      this.hasPermission = hasPermission;

      if (hasPermission) {
        this.loadGroups();
      } else {
        this.loading = false;
        this.snackBar.open('You do not have permission to access this page', 'Close', { duration: 5000 });
      }
    });
  }

  loadGroups(): void {
    this.loading = true;
    this.groupService.getGroups().subscribe({
      next: (groups) => {
        this.groups = groups.map(group => {
          // Ensure users is an array
          if (!group.users) {
            group.users = [];
          }
          return group;
        });
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading groups:', error);
        this.loading = false;
        if (error.status === 403) {
          this.hasPermission = false;
          this.snackBar.open('You do not have permission to view groups', 'Close', { duration: 5000 });
        } else {
          this.snackBar.open('Error loading groups', 'Close', { duration: 3000 });
        }
      }
    });
  }

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
        this.onGroupSaved(result, groupData);
      }
    });
  }

  onGroupSaved(groupData: Partial<Group>, originalGroup: Group | null): void {
    if (originalGroup) {
      // Edit mode
      this.groupService.updateGroup(originalGroup.id, groupData).subscribe({
        next: () => {
          Object.assign(originalGroup, groupData);
          this.snackBar.open('Group updated successfully', 'Close', { duration: 3000 });
        },
        error: (error) => {
          console.error('Error updating group:', error);
          this.snackBar.open('Error updating group', 'Close', { duration: 3000 });
        }
      });
    } else {
      // Create mode
      this.groupService.createGroup(groupData).subscribe({
        next: (group) => {
          if (!group.users) {
            group.users = [];
          }
          this.groups.push(group);
          this.snackBar.open('Group created successfully', 'Close', { duration: 3000 });
        },
        error: (error) => {
          console.error('Error creating group:', error);
          this.snackBar.open('Error creating group', 'Close', { duration: 3000 });
        }
      });
    }
  }

  deleteGroup(group: Group): void {
    if (confirm(`Are you sure you want to delete the group "${group.name}"?`)) {
      this.groupService.deleteGroup(group.id).subscribe({
        next: () => {
          this.groups = this.groups.filter(g => g.id !== group.id);
          this.snackBar.open('Group deleted successfully', 'Close', { duration: 3000 });
        },
        error: (error) => {
          console.error('Error deleting group:', error);
          if (error.status === 403) {
            this.snackBar.open('You do not have permission to delete groups', 'Close', { duration: 5000 });
          } else {
            this.snackBar.open('Error deleting group', 'Close', { duration: 3000 });
          }
        }
      });
    }
  }

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


  onUserSelected(event: { user: User; group: Group }): void {
    const { user, group } = event;

    // Use non-deprecated method with default member permissions
    const defaultPermissions: Permission[] = GROUP_PERMISSION_SETS['MEMBER'];
    this.groupService.addMemberWithPermissions(group.id, user.id, defaultPermissions).subscribe({
      next: () => {
        this.loadGroups(); // Reload to get updated member list
        this.snackBar.open(`${user.firstName} ${user.lastName} added to ${group.name} successfully`, 'Close', { duration: 3000 });
      },
      error: (error) => {
        console.error('Error adding member:', error);
        this.snackBar.open('Error adding member to group', 'Close', { duration: 3000 });
      }
    });
  }

  removeMember(group: Group, member: User): void {
    if (confirm(`Are you sure you want to remove ${(member.firstName || '') + ' ' + (member.lastName || '') || member.email} from the group?`)) {
      this.groupService.removeMember(group.id, member.id).subscribe({
        next: () => {
          if (group.users) {
            group.users = group.users.filter(u => u.id !== member.id);
          }
          this.snackBar.open('Member removed successfully', 'Close', { duration: 3000 });
        },
        error: (error) => {
          console.error('Error removing member:', error);
          this.snackBar.open('Error removing member', 'Close', { duration: 3000 });
        }
      });
    }
  }

  makeAdmin(group: Group, member: User): void {
    // Use non-deprecated method with admin permissions
    const adminPermissions: Permission[] = GROUP_PERMISSION_SETS['ADMIN'];
    this.groupService.updateMemberPermissions(group.id, member.id, adminPermissions).subscribe({
      next: () => {
        // Update the user's role in the local data
        if (member.roles && member.roles.length > 0) {
          member.roles[0].name = 'Admin';
        }
        this.snackBar.open('Member role updated successfully', 'Close', { duration: 3000 });
      },
      error: (error) => {
        console.error('Error updating member permissions:', error);
        this.snackBar.open('Error updating member permissions', 'Close', { duration: 3000 });
      }
    });
  }

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


  onMemberActionSelected(event: { action: MemberAction; member: User; group: Group }): void {
    console.log('[GroupsComponent] Member action selected:', event.action.id, 'for member:', (event.member.firstName || '') + ' ' + (event.member.lastName || '') || event.member.email);

    switch (event.action.id) {
      case 'make-admin':
        this.makeAdmin(event.group, event.member);
        break;
      case 'remove-member':
        this.removeMember(event.group, event.member);
        break;
      default:
        console.warn('[GroupsComponent] Unknown action:', event.action.id);
    }
  }

  goToDashboard(): void {
    this.router.navigate(['/app/dashboard']);
  }
}
