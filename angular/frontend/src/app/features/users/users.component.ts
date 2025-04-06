import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UserService, User } from '../../services/user.service';
import { GroupService, Group } from '../../services/group.service';
import { AuthService } from '../../core/services/auth.service';
import { Router } from '@angular/router';
import { forkJoin, of, catchError, mergeMap, map } from 'rxjs';
import { LoggerService } from '../../services/logging/logger.service';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatChipsModule
  ],
  template: `
    <div class="users-container">
      <h1>Users</h1>
      
      <div *ngIf="loading" class="loading">
        Loading users...
      </div>
      
      <ng-container *ngIf="!loading">
        <div class="actions-bar" *ngIf="isAdminOrProjectManager">
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
            <td mat-cell *matCellDef="let user">{{ user.name || 'Unknown' }}</td>
          </ng-container>
          
          <!-- Email Column -->
          <ng-container matColumnDef="email">
            <th mat-header-cell *matHeaderCellDef>Email</th>
            <td mat-cell *matCellDef="let user">{{ user.email || 'No email available' }}</td>
          </ng-container>
          
          <!-- Role Column -->
          <ng-container matColumnDef="role">
            <th mat-header-cell *matHeaderCellDef>Role</th>
            <td mat-cell *matCellDef="let user">{{ user.role || 'User' }}</td>
          </ng-container>

          <!-- Groups Column -->
          <ng-container matColumnDef="groups">
            <th mat-header-cell *matHeaderCellDef>Groups</th>
            <td mat-cell *matCellDef="let user">
              <div *ngIf="!user.groups || user.groups.length === 0" class="no-groups">
                No groups
              </div>
              <mat-chip-listbox *ngIf="user.groups && user.groups.length > 0">
                <mat-chip *ngFor="let group of user.groups">
                  {{ group.name }}
                  <button *ngIf="canManageGroups(user)" matChipRemove (click)="removeFromGroup(user, group)">
                    <mat-icon>cancel</mat-icon>
                  </button>
                </mat-chip>
              </mat-chip-listbox>
              <button *ngIf="canManageGroups(user)" mat-icon-button [matMenuTriggerFor]="groupMenu">
                <mat-icon>add_circle</mat-icon>
              </button>
              <mat-menu #groupMenu="matMenu">
                <div class="no-groups-available" *ngIf="getAvailableGroupsForUser(user).length === 0">
                  <span class="menu-item-text">No available groups</span>
                </div>
                <button mat-menu-item *ngFor="let group of getAvailableGroupsForUser(user)" (click)="addToGroup(user, group)">
                  {{ group.name }}
                </button>
              </mat-menu>
            </td>
          </ng-container>
          
          <!-- Actions Column -->
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef>Actions</th>
            <td mat-cell *matCellDef="let user">
              <button *ngIf="isAdminOrProjectManager" mat-icon-button color="primary" (click)="editUser(user)">
                <mat-icon>edit</mat-icon>
              </button>
              <button *ngIf="isAdminOrProjectManager" mat-icon-button color="warn" (click)="deleteUser(user)">
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
      min-width: 200px;
    }
    
    .mat-chip-listbox {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-right: 8px;
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
    
    .no-groups {
      font-style: italic;
      color: #666;
    }
    
    .menu-item-text {
      padding: 0 16px;
      display: block;
      line-height: 48px;
      color: #666;
      font-style: italic;
    }
  `]
})
export class UsersComponent implements OnInit {
  displayedColumns: string[] = ['id', 'name', 'email', 'role', 'groups', 'actions'];
  users: User[] = [];
  availableGroups: Group[] = [];
  loading = true;
  currentUserGroups: Group[] = [];
  currentUser: User | null = null;

  constructor(
    private userService: UserService,
    private groupService: GroupService,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private router: Router,
    private logger: LoggerService
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      if (user) {
        this.currentUser = this.convertAuthUserToUserModel(user);
        this.loadData();
      } else {
        this.loading = false;
        this.router.navigate(['/login']);
      }
    });
  }

  // Convert auth user to our User model since they might have different structures
  convertAuthUserToUserModel(authUser: any): User {
    return {
      id: authUser.id,
      name: `${authUser.firstName || ''} ${authUser.lastName || ''}`.trim() || authUser.email,
      email: authUser.email,
      role: authUser.roles ? authUser.roles[0] : 'User', // Just use first role for display
      groups: [] // Groups will be populated when we load user data
    };
  }

  get isAdminOrProjectManager(): boolean {
    return this.authService.hasRole('ADMIN') || this.authService.hasRole('PROJECT_MANAGER');
  }

  loadData(): void {
    this.loading = true;

    if (this.isAdminOrProjectManager) {
      // For admin/project manager users, load all users and groups
      forkJoin({
        users: this.userService.getUsers().pipe(
          catchError(error => {
            console.error('Error loading all users:', error);
            this.snackBar.open('Error loading users', 'Close', { duration: 3000 });
            return of([]);
          })
        ),
        groups: this.groupService.getGroups().pipe(
          catchError(error => {
            console.error('Error loading all groups:', error);
            this.snackBar.open('Error loading groups', 'Close', { duration: 3000 });
            return of([]);
          })
        )
      }).subscribe(result => {
        this.users = result.users;
        this.availableGroups = result.groups;
        this.loading = false;
      });
    } else {
      // For regular users, directly load their profile since we already have basic info
      if (this.currentUser) {
        this.users = [this.currentUser];
        
        // Try to get a more complete profile with groups
        this.userService.getUser(this.currentUser.id).pipe(
          catchError(error => {
            console.error('Error loading user profile:', error);
            return of(this.currentUser); // Use the basic info we already have
          })
        ).subscribe(userProfile => {
          // If we got a profile, update the user in our list
          if (userProfile) {
            this.users[0] = userProfile;
            
            // If the user has groups, update currentUserGroups
            if (userProfile.groups && userProfile.groups.length > 0) {
              this.currentUserGroups = userProfile.groups.map(group => ({
                id: group.id,
                name: group.name,
                description: '',
                owner: '',
                members: []
              }));
              
              // Set available groups
              this.availableGroups = this.currentUserGroups;
              
              // Try to get members of each group
              this.loadGroupMembers();
            } else {
              // No groups, get them separately
              this.loadUserGroups();
            }
          } else {
            this.loading = false;
          }
        });
      } else {
        this.loading = false;
      }
    }
  }
  
  // Load user's groups if not included in profile
  loadUserGroups(): void {
    if (!this.currentUser) {
      this.loading = false;
      return;
    }
    
    this.userService.getUserGroups(this.currentUser.id).pipe(
      catchError(error => {
        console.error('Error loading user groups:', error);
        return of([]);
      })
    ).subscribe(groups => {
      // Update current user's groups
      if (this.users[0]) {
        this.users[0].groups = groups;
      }
      
      // Store groups for filtering and access control
      this.currentUserGroups = groups.map(group => ({
        id: group.id,
        name: group.name,
        description: '',
        owner: '',
        members: []
      }));
      
      // Set available groups
      this.availableGroups = this.currentUserGroups;
      
      // Try to load members from groups
      if (groups.length > 0) {
        this.loadGroupMembers();
      } else {
        this.loading = false;
      }
    });
  }
  
  // Load members from user's groups
  loadGroupMembers(): void {
    if (this.currentUserGroups.length === 0) {
      this.loading = false;
      return;
    }
    
    // Process each group to get its members
    const memberRequests = this.currentUserGroups.map(group => 
      this.groupService.getGroupMembers(group.id).pipe(
        catchError(() => of([]))
      )
    );
    
    // Execute all requests
    forkJoin(memberRequests).subscribe(groupMembersArrays => {
      // Flatten all member arrays and remove duplicates
      const allMembers: User[] = [];
      
      groupMembersArrays.forEach(members => {
        members.forEach(member => {
          if (!allMembers.some(m => m.id === member.id) && 
              member.id !== this.currentUser?.id) {
            allMembers.push(member);
          }
        });
      });
      
      // Add all unique members to the users array
      if (allMembers.length > 0) {
        this.users = [this.currentUser!, ...allMembers];
      }
      
      this.loading = false;
    });
  }

  // Determine if the user can manage groups for a given user
  canManageGroups(user: User): boolean {
    if (this.isAdminOrProjectManager) {
      return true;
    }
    
    // Regular users can only manage their own groups
    return this.currentUser?.id === user.id;
  }

  // Get available groups for a specific user
  getAvailableGroupsForUser(user: User): Group[] {
    if (!user.groups) {
      user.groups = [];
    }
    
    if (this.isAdminOrProjectManager) {
      // Admins/PMs can add users to any group
      // Filter out groups that user is already in
      return this.availableGroups.filter(group => 
        !user.groups?.some(userGroup => userGroup.id === group.id)
      );
    } else if (this.currentUser?.id === user.id) {
      // Regular users can only add themselves to their available groups
      // For now, regular users can't add themselves to groups
      // If you want to allow this, you'd need to implement logic to 
      // determine which groups they can join
      return [];
    } else {
      // Regular users can add other users to their groups
      // Filter to show only groups the current user is in
      // and the target user is not in
      return this.currentUserGroups.filter(group => 
        !user.groups?.some(userGroup => userGroup.id === group.id)
      );
    }
  }

  goToDashboard(): void {
    this.router.navigate(['/app/dashboard']);
  }

  createUser(): void {
    this.logger.info('Navigating to create user page');
    this.router.navigate(['/app/users/create']);
  }

  editUser(user: User): void {
    // Implement user edit logic
    console.log('Edit user clicked', user);
  }

  deleteUser(user: User): void {
    if (confirm(`Are you sure you want to delete ${user.name}?`)) {
      this.userService.deleteUser(user.id).subscribe({
        next: () => {
          this.users = this.users.filter(u => u.id !== user.id);
          this.snackBar.open('User deleted successfully', 'Close', { duration: 3000 });
        },
        error: (error: any) => {
          console.error('Error deleting user:', error);
          this.snackBar.open('Error deleting user', 'Close', { duration: 3000 });
        }
      });
    }
  }

  addToGroup(user: User, group: Group): void {
    this.userService.addUserToGroup(user.id, group.id).subscribe({
      next: () => {
        if (!user.groups) {
          user.groups = [];
        }
        user.groups.push({
          id: group.id,
          name: group.name
        });
        this.snackBar.open(`Added ${user.name} to ${group.name}`, 'Close', { duration: 3000 });
      },
      error: (error: any) => {
        console.error('Error adding user to group:', error);
        this.snackBar.open('Error adding user to group', 'Close', { duration: 3000 });
      }
    });
  }

  removeFromGroup(user: User, group: any): void {
    this.userService.removeUserFromGroup(user.id, group.id).subscribe({
      next: () => {
        user.groups = user.groups.filter(g => g.id !== group.id);
        this.snackBar.open(`Removed ${user.name} from ${group.name}`, 'Close', { duration: 3000 });
      },
      error: (error: any) => {
        console.error('Error removing user from group:', error);
        this.snackBar.open('Error removing user from group', 'Close', { duration: 3000 });
      }
    });
  }
}
