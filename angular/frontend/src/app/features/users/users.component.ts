import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UserService, User } from '../../services/user.service';
import { GroupService } from '../../services/group.service';
import { AuthService } from '../../core/services/auth.service';
import { Router } from '@angular/router';

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
      
      <div *ngIf="!hasPermission" class="permission-error">
        <p>You do not have permission to view this page.</p>
        <button mat-raised-button color="primary" (click)="goToDashboard()">Go to Dashboard</button>
      </div>
      
      <ng-container *ngIf="hasPermission">
        <div class="actions-bar">
          <button mat-raised-button color="primary" (click)="createUser()">
            <mat-icon>add</mat-icon> Add User
          </button>
        </div>
        
        <div *ngIf="loading" class="loading">
          Loading users...
        </div>
        
        <table *ngIf="!loading" mat-table [dataSource]="users" class="users-table">
          <!-- ID Column -->
          <ng-container matColumnDef="id">
            <th mat-header-cell *matHeaderCellDef>ID</th>
            <td mat-cell *matCellDef="let user">{{ user.id }}</td>
          </ng-container>
          
          <!-- Name Column -->
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Name</th>
            <td mat-cell *matCellDef="let user">{{ user.name }}</td>
          </ng-container>
          
          <!-- Email Column -->
          <ng-container matColumnDef="email">
            <th mat-header-cell *matHeaderCellDef>Email</th>
            <td mat-cell *matCellDef="let user">{{ user.email }}</td>
          </ng-container>
          
          <!-- Role Column -->
          <ng-container matColumnDef="role">
            <th mat-header-cell *matHeaderCellDef>Role</th>
            <td mat-cell *matCellDef="let user">{{ user.role }}</td>
          </ng-container>

          <!-- Groups Column -->
          <ng-container matColumnDef="groups">
            <th mat-header-cell *matHeaderCellDef>Groups</th>
            <td mat-cell *matCellDef="let user">
              <mat-chip-listbox>
                <mat-chip *ngFor="let group of user.groups">
                  {{ group.name }}
                  <button matChipRemove (click)="removeFromGroup(user, group)">
                    <mat-icon>cancel</mat-icon>
                  </button>
                </mat-chip>
              </mat-chip-listbox>
              <button mat-icon-button [matMenuTriggerFor]="groupMenu">
                <mat-icon>add_circle</mat-icon>
              </button>
              <mat-menu #groupMenu="matMenu">
                <button mat-menu-item *ngFor="let group of availableGroups" (click)="addToGroup(user, group)">
                  {{ group.name }}
                </button>
              </mat-menu>
            </td>
          </ng-container>
          
          <!-- Actions Column -->
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef>Actions</th>
            <td mat-cell *matCellDef="let user">
              <button mat-icon-button color="primary" (click)="editUser(user)">
                <mat-icon>edit</mat-icon>
              </button>
              <button mat-icon-button color="warn" (click)="deleteUser(user)">
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

    .loading {
      text-align: center;
      padding: 20px;
    }
  `]
})
export class UsersComponent implements OnInit {
  displayedColumns: string[] = ['id', 'name', 'email', 'role', 'groups', 'actions'];
  users: User[] = [];
  availableGroups: any[] = [];
  hasPermission = false;
  loading = true;

  constructor(
    private userService: UserService,
    private groupService: GroupService,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Check if user has admin role
    this.authService.currentUser$.subscribe(user => {
      if (user?.roles?.includes('admin')) {
        this.hasPermission = true;
        this.loadUsers();
        this.loadGroups();
      } else {
        this.hasPermission = false;
        this.loading = false;
        this.snackBar.open('You do not have permission to access this page', 'Close', { duration: 5000 });
      }
    });
  }

  loadUsers(): void {
    this.loading = true;
    this.userService.getUsers().subscribe({
      next: (users) => {
        this.users = users;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading users:', error);
        this.loading = false;
        if (error.status === 403) {
          this.hasPermission = false;
          this.snackBar.open('You do not have permission to view users', 'Close', { duration: 5000 });
        } else {
          this.snackBar.open('Error loading users', 'Close', { duration: 3000 });
        }
      }
    });
  }

  loadGroups(): void {
    this.groupService.getGroups().subscribe({
      next: (groups) => {
        this.availableGroups = groups;
      },
      error: (error) => {
        console.error('Error loading groups:', error);
        if (error.status === 403) {
          this.snackBar.open('You do not have permission to view groups', 'Close', { duration: 5000 });
        } else {
          this.snackBar.open('Error loading groups', 'Close', { duration: 3000 });
        }
      }
    });
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  createUser(): void {
    // TODO: Implement user creation dialog
    console.log('Create user clicked');
  }

  editUser(user: User): void {
    // TODO: Implement user editing dialog
    console.log('Edit user clicked', user);
  }

  deleteUser(user: User): void {
    if (confirm(`Are you sure you want to delete user ${user.name}?`)) {
      this.userService.deleteUser(user.id).subscribe({
        next: () => {
          this.users = this.users.filter(u => u.id !== user.id);
          this.snackBar.open('User deleted successfully', 'Close', { duration: 3000 });
        },
        error: (error) => {
          console.error('Error deleting user:', error);
          if (error.status === 403) {
            this.snackBar.open('You do not have permission to delete users', 'Close', { duration: 5000 });
          } else {
            this.snackBar.open('Error deleting user', 'Close', { duration: 3000 });
          }
        }
      });
    }
  }

  addToGroup(user: User, group: any): void {
    this.groupService.addMember(group.id, user.id).subscribe({
      next: () => {
        if (!user.groups.find(g => g.id === group.id)) {
          user.groups.push(group);
        }
        this.snackBar.open('User added to group successfully', 'Close', { duration: 3000 });
      },
      error: (error) => {
        console.error('Error adding user to group:', error);
        if (error.status === 403) {
          this.snackBar.open('You do not have permission to modify group memberships', 'Close', { duration: 5000 });
        } else {
          this.snackBar.open('Error adding user to group', 'Close', { duration: 3000 });
        }
      }
    });
  }

  removeFromGroup(user: User, group: any): void {
    this.groupService.removeMember(group.id, user.id).subscribe({
      next: () => {
        user.groups = user.groups.filter(g => g.id !== group.id);
        this.snackBar.open('User removed from group successfully', 'Close', { duration: 3000 });
      },
      error: (error) => {
        console.error('Error removing user from group:', error);
        if (error.status === 403) {
          this.snackBar.open('You do not have permission to modify group memberships', 'Close', { duration: 5000 });
        } else {
          this.snackBar.open('Error removing user from group', 'Close', { duration: 3000 });
        }
      }
    });
  }
}
