import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { GroupService } from '../../services/group.service';
import { UserService } from '../../services/user.service';
import { Group, Member, Permission, GROUP_PERMISSION_SETS } from '../../models/group.model';
import { User } from '../../models/user.model';
import { GroupDialogComponent } from './group-dialog/group-dialog.component';
import { UserSelectorSidebarComponent } from './user-selector-sidebar/user-selector-sidebar.component';
import { AuthService } from '../../core/services/auth.service';
import { Router } from '@angular/router';
import { PermissionService } from '../../core/services/permission.service';

@Component({
  selector: 'app-groups',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatDialogModule,
    MatMenuModule,
    MatListModule,
    UserSelectorSidebarComponent
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
                <h3>Members ({{ group.members ? group.members.length : 0 }})</h3>
                <mat-list *ngIf="group.members && group.members.length > 0">
                  <mat-list-item *ngFor="let member of group.members">
                    <span matListItemTitle>{{ member.name }}</span>
                    <span matListItemLine>{{ member.role || 'Member' }}</span>
                    <button mat-icon-button [matMenuTriggerFor]="memberMenu" matListItemMeta>
                      <mat-icon>more_vert</mat-icon>
                    </button>
                    <mat-menu #memberMenu="matMenu">
                      <button mat-menu-item (click)="makeAdmin(group, member)">
                        <mat-icon>admin_panel_settings</mat-icon>
                        <span>Make Admin</span>
                      </button>
                      <button mat-menu-item (click)="removeMember(group, member)">
                        <mat-icon>remove_circle</mat-icon>
                        <span>Remove from Group</span>
                      </button>
                    </mat-menu>
                  </mat-list-item>
                </mat-list>
                <div *ngIf="!group.members || group.members.length === 0" class="no-members">
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
      
      <!-- User Selector Sidebar -->
      <app-user-selector-sidebar
        [isOpen]="isUserSelectorOpen"
        [group]="selectedGroupForUser"
        [availableUsers]="availableUsers"
        (closeSidebar)="closeUserSelector()"
        (userSelected)="onUserSelected($event)">
      </app-user-selector-sidebar>
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
      z-index: 10;
      position: relative;
      pointer-events: auto;
    }
  `]
})
export class GroupsComponent implements OnInit {
  groups: Group[] = [];
  hasPermission = false;
  loading = true;
  
  // Sidebar state management
  isUserSelectorOpen = false;
  selectedGroupForUser: Group | null = null;
  availableUsers: User[] = [];
  
  constructor(
    private groupService: GroupService,
    private userService: UserService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private authService: AuthService,
    private router: Router,
    private permissionService: PermissionService
  ) {}

  ngOnInit(): void {
    // Check permission to view groups using resource:action format
    this.permissionService.hasPermission('groups:read').subscribe(hasPermission => {
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
          // Ensure members is an array
          if (!group.members) {
            group.members = [];
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
    const dialogRef = this.dialog.open(GroupDialogComponent, {
      data: { group: null }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.groupService.createGroup(result).subscribe({
          next: (group) => {
            if (!group.members) {
              group.members = [];
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
    });
  }

  editGroup(group: Group): void {
    const dialogRef = this.dialog.open(GroupDialogComponent, {
      data: { group }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.groupService.updateGroup(group.id, result).subscribe({
          next: () => {
            Object.assign(group, result);
            this.snackBar.open('Group updated successfully', 'Close', { duration: 3000 });
          },
          error: (error) => {
            console.error('Error updating group:', error);
            this.snackBar.open('Error updating group', 'Close', { duration: 3000 });
          }
        });
      }
    });
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
    this.selectedGroupForUser = group;
    this.loadAvailableUsers(group);
    this.isUserSelectorOpen = true;
  }
  
  private loadAvailableUsers(group: Group): void {
    this.userService.getUsers().subscribe({
      next: (users) => {
        // Filter out users who are already members of the group
        const memberIds = group.members?.map(member => member.id) || [];
        this.availableUsers = users.filter(user => !memberIds.includes(user.id));
      },
      error: (error) => {
        console.error('Error loading available users:', error);
        this.snackBar.open('Error loading available users', 'Close', { duration: 3000 });
        this.availableUsers = [];
      }
    });
  }
  
  closeUserSelector(): void {
    this.isUserSelectorOpen = false;
    this.selectedGroupForUser = null;
    this.availableUsers = [];
  }
  
  onUserSelected(event: { user: User; group: Group }): void {
    const { user, group } = event;
    
    // Use non-deprecated method with default member permissions
    const defaultPermissions: Permission[] = GROUP_PERMISSION_SETS['MEMBER'];
    this.groupService.addMemberWithPermissions(group.id, user.id, defaultPermissions).subscribe({
      next: () => {
        this.loadGroups(); // Reload to get updated member list
        this.snackBar.open(`${user.firstName} ${user.lastName} added to ${group.name} successfully`, 'Close', { duration: 3000 });
        this.closeUserSelector();
      },
      error: (error) => {
        console.error('Error adding member:', error);
        this.snackBar.open('Error adding member to group', 'Close', { duration: 3000 });
      }
    });
  }

  removeMember(group: Group, member: Member): void {
    if (confirm(`Are you sure you want to remove ${member.name} from the group?`)) {
      this.groupService.removeMember(group.id, member.id).subscribe({
        next: () => {
          if (group.members) {
            group.members = group.members.filter(m => m.id !== member.id);
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

  makeAdmin(group: Group, member: Member): void {
    this.groupService.updateMemberRole(group.id, member.id, 'Admin').subscribe({
      next: () => {
        member.role = 'Admin';
        this.snackBar.open('Member role updated successfully', 'Close', { duration: 3000 });
      },
      error: (error) => {
        console.error('Error updating member role:', error);
        this.snackBar.open('Error updating member role', 'Close', { duration: 3000 });
      }
    });
  }

  goToDashboard(): void {
    this.router.navigate(['/app/dashboard']);
  }
}
