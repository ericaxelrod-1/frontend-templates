import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RoleService, Role } from '../../services/role.service';
import { RoleCreationSidebarComponent } from './role-creation-sidebar/role-creation-sidebar.component';
import { AuthService } from '../../core/services/auth.service';
import { Router } from '@angular/router';
import { PermissionService } from '../../core/services/permission.service';
import { SidePanelService } from '../../shared/components/side-panel';

@Component({
  selector: 'app-roles',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatChipsModule
  ],
  template: `
    <div class="roles-container">
      <h1>Roles</h1>

      <div *ngIf="!hasPermission" class="permission-error">
        <p>You do not have permission to view this page.</p>
        <button mat-raised-button color="primary" (click)="goToDashboard()">Go to Dashboard</button>
      </div>

      <ng-container *ngIf="hasPermission">
        <div class="actions-bar">
          <button mat-raised-button color="primary" (click)="createRole()">
            <mat-icon>add</mat-icon> Create Role
          </button>
        </div>

        <div *ngIf="loading" class="loading">
          Loading roles...
        </div>

        <table *ngIf="!loading" mat-table [dataSource]="roles" class="roles-table">
          <!-- Name Column -->
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Name</th>
            <td mat-cell *matCellDef="let role">{{ role.name }}</td>
          </ng-container>

          <!-- Description Column -->
          <ng-container matColumnDef="description">
            <th mat-header-cell *matHeaderCellDef>Description</th>
            <td mat-cell *matCellDef="let role">{{ role.description }}</td>
          </ng-container>

          <!-- Permissions Column -->
          <ng-container matColumnDef="permissions">
            <th mat-header-cell *matHeaderCellDef>Permissions</th>
            <td mat-cell *matCellDef="let role">
              <mat-chip-set>
                <!-- Use keyvalue pipe when permissions is an object -->
                <ng-container *ngIf="!Array.isArray(role.permissions); else permissionArray">
                  <mat-chip *ngFor="let permission of role.permissions | keyvalue" 
                           [color]="permission.value ? 'primary' : undefined">
                    {{ permission.key }}
                  </mat-chip>
                </ng-container>
                
                <!-- Use regular iteration when permissions is an array -->
                <ng-template #permissionArray>
                  <mat-chip *ngFor="let permission of role.permissions">
                    {{ permission.name }}
                  </mat-chip>
                </ng-template>
              </mat-chip-set>
            </td>
          </ng-container>

          <!-- Users Column -->
          <ng-container matColumnDef="users">
            <th mat-header-cell *matHeaderCellDef>Users</th>
            <td mat-cell *matCellDef="let role">{{ role.userCount || 0 }}</td>
          </ng-container>

          <!-- Actions Column -->
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef>Actions</th>
            <td mat-cell *matCellDef="let role">
              <button mat-icon-button color="primary" (click)="editRole(role)">
                <mat-icon>edit</mat-icon>
              </button>
              <button mat-icon-button color="warn" (click)="deleteRole(role)">
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
    .roles-container {
      padding: 20px;
    }

    .actions-bar {
      margin-bottom: 20px;
    }

    .roles-table {
      width: 100%;
    }

    .mat-column-actions {
      width: 100px;
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
export class RolesComponent implements OnInit {
  displayedColumns: string[] = ['name', 'description', 'permissions', 'users', 'actions'];
  roles: Role[] = [];
  hasPermission = false;
  loading = true;

  // Make Array available in the template
  protected Array = Array;

  constructor(
    private roleService: RoleService,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private router: Router,
    private permissionService: PermissionService,
    private sidePanelService: SidePanelService
  ) { }

  ngOnInit(): void {
    // Check permission to view roles using resource:action format
    this.permissionService.hasPermission('roles:view').subscribe(hasPermission => {
      console.log('[RolesComponent] Permission check result:', hasPermission);
      this.hasPermission = hasPermission;

      if (hasPermission) {
        this.loadRoles();
      } else {
        this.loading = false;
        this.snackBar.open('You do not have permission to access this page', 'Close', { duration: 5000 });
      }
    });
  }

  loadRoles(): void {
    this.loading = true;
    this.roleService.getRoles().subscribe({
      next: (roles) => {
        this.roles = roles;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading roles:', error);
        this.loading = false;
        if (error.status === 403) {
          this.hasPermission = false;
          this.snackBar.open('You do not have permission to view roles', 'Close', { duration: 5000 });
        } else {
          this.snackBar.open('Error loading roles', 'Close', { duration: 3000 });
        }
      }
    });
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  createRole(): void {
    this.openRolePanel(null);
  }

  editRole(role: Role): void {
    if (!role.id) {
      this.snackBar.open('Cannot edit role without an ID', 'Close', { duration: 3000 });
      return;
    }
    this.openRolePanel(role);
  }

  private openRolePanel(roleData: Role | null): void {
    const ref = this.sidePanelService.open(RoleCreationSidebarComponent, {
      data: { roleData },
      width: '600px'
    });
    ref.afterClosed().subscribe(result => {
      if (result) {
        this.onRoleSaved(result, roleData?.id);
      }
    });
  }

  onRoleSaved(roleData: Partial<Role>, roleId?: number): void {
    if (roleId) {
      // Edit mode - update existing role
      this.roleService.updateRole(roleId, roleData).subscribe({
        next: () => {
          this.snackBar.open('Role updated successfully', 'Close', { duration: 3000 });
          // Reload the entire roles list to ensure data consistency
          this.loadRoles();
        },
        error: (error) => {
          console.error('Error updating role:', error);
          this.snackBar.open('Error updating role', 'Close', { duration: 3000 });
        }
      });
    } else {
      // Create mode - create new role
      this.roleService.createRole(roleData).subscribe({
        next: (role) => {
          this.snackBar.open('Role created successfully', 'Close', { duration: 3000 });
          // Reload the entire roles list to ensure the new role appears with all data
          this.loadRoles();
        },
        error: (error) => {
          console.error('Error creating role:', error);
          this.snackBar.open('Error creating role', 'Close', { duration: 3000 });
        }
      });
    }
  }

  deleteRole(role: Role): void {
    if (!role.id) {
      this.snackBar.open('Cannot delete role without an ID', 'Close', { duration: 3000 });
      return;
    }

    if (role.userCount && role.userCount > 0) {
      this.snackBar.open('Cannot delete role with assigned users', 'Close', { duration: 3000 });
      return;
    }

    if (confirm(`Are you sure you want to delete the role "${role.name}"?`)) {
      this.roleService.deleteRole(role.id!).subscribe({
        next: () => {
          this.roles = this.roles.filter(r => r.id !== role.id);
          this.snackBar.open('Role deleted successfully', 'Close', { duration: 3000 });
        },
        error: (error) => {
          console.error('Error deleting role:', error);
          this.snackBar.open('Error deleting role', 'Close', { duration: 3000 });
        }
      });
    }
  }
} 