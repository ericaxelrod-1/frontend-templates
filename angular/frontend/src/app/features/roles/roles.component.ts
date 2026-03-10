import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { ViewChild, AfterViewInit } from '@angular/core';
import { merge, of } from 'rxjs';
import { startWith, switchMap, catchError, map, debounceTime, tap } from 'rxjs/operators';
import { RoleService, Role } from '../../services/role.service';
import { PageTitleService } from '../../core/services/page-title.service';
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
    MatChipsModule,
    MatSortModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule
  ],
  template: `
    <div class="roles-container">
      <div *ngIf="!hasPermission" class="permission-error">
        <p>You do not have permission to view this page.</p>
        <button mat-raised-button color="primary" (click)="goToDashboard()">Go to Dashboard</button>
      </div>

      <ng-container *ngIf="hasPermission">
        <div class="actions-bar">
          <mat-form-field appearance="outline" class="search-field">
            <mat-label>Search roles</mat-label>
            <mat-icon matPrefix>search</mat-icon>
            <input matInput [formControl]="searchControl" placeholder="Search by name or description">
          </mat-form-field>

          <button mat-raised-button color="primary" (click)="createRole()" class="create-button">
            <mat-icon>add</mat-icon> Create Role
          </button>
        </div>

        <div class="table-container">
          <div *ngIf="loading" class="loading-overlay">
            <mat-spinner diameter="40"></mat-spinner>
          </div>

          <table mat-table [dataSource]="dataSource" class="roles-table" matSort matSortActive="name" matSortDirection="asc">
          <!-- Name Column -->
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef mat-sort-header>Name</th>
            <td mat-cell *matCellDef="let role">{{ role.name }}</td>
          </ng-container>

          <!-- Description Column -->
          <ng-container matColumnDef="description">
            <th mat-header-cell *matHeaderCellDef mat-sort-header>Description</th>
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
          
          <tr class="mat-row empty-state-row" *matNoDataRow>
            <td class="mat-cell" colspan="5" *ngIf="!loading">
              <div class="empty-state-content">
                 <p *ngIf="searchControl.value">No roles found matching "{{searchControl.value}}"</p>
                 <p *ngIf="!searchControl.value">No roles available</p>
              </div>
            </td>
          </tr>
        </table>
        
        <mat-paginator [length]="totalCount"
                       [pageSize]="pageSize"
                       [pageSizeOptions]="[5, 10, 25, 100]"
                       aria-label="Select page of roles">
        </mat-paginator>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
    .roles-container {
      padding: 20px;
    }

    .actions-bar {
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }

    .search-field {
      flex: 1;
      max-width: 400px;
    }

    .create-button {
      height: 48px; /* Match form field height */
    }

    .table-container {
      position: relative;
      background: white;
      border-radius: 4px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    
    .loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255, 255, 255, 0.7);
      z-index: 10;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    
    .empty-state-row td {
      text-align: center;
      padding: 40px !important;
    }

    .empty-state-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      color: #666;
    }

    .roles-table {
      width: 100%;
    }

    .roles-table .mat-cell,
    .roles-table .mat-header-cell {
      padding-top: 16px;
      padding-bottom: 16px;
    }

    .mat-column-actions {
      width: 100px;
    }
  `]
})
export class RolesComponent implements OnInit, AfterViewInit {
  displayedColumns: string[] = ['name', 'description', 'permissions', 'users', 'actions'];

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  dataSource: Role[] = [];
  totalCount = 0;
  pageSize = 10;
  loading = true;
  hasPermission = false;
  searchControl = new FormControl('');

  private reactivePatternInitialized = false;
  private shouldInitializeReactivePattern = false;

  // Make Array available in the template
  protected Array = Array;

  constructor(
    private roleService: RoleService,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private router: Router,
    private permissionService: PermissionService,
    private sidePanelService: SidePanelService,
    private pageTitleService: PageTitleService
  ) { }

  ngOnInit(): void {
    this.pageTitleService.setTitle('Roles');

    // Check permission to view roles using resource:action format
    this.permissionService.hasPermission('roles:view').subscribe(hasPermission => {
      console.log('[RolesComponent] Permission check result:', hasPermission);
      this.hasPermission = hasPermission;

      if (hasPermission) {
        this.shouldInitializeReactivePattern = true;
        this.tryInitializeReactivePattern();
      } else {
        this.loading = false;
        this.snackBar.open('You do not have permission to access this page', 'Close', { duration: 5000 });
      }
    });
  }

  ngAfterViewInit() {
    this.tryInitializeReactivePattern();
  }

  private tryInitializeReactivePattern() {
    if (this.shouldInitializeReactivePattern && this.sort && this.paginator && !this.reactivePatternInitialized) {
      this.initializeReactivePattern();
    }
  }

  private initializeReactivePattern() {
    this.reactivePatternInitialized = true;

    // Sort change will reset the paginator
    this.sort.sortChange.subscribe(() => this.paginator.pageIndex = 0);

    merge(
      this.sort.sortChange,
      this.paginator.page,
      this.searchControl.valueChanges.pipe(
        debounceTime(300),
        tap(() => {
          this.paginator.pageIndex = 0;
        })
      )
    )
      .pipe(
        startWith({}),
        switchMap(() => {
          this.loading = true;
          return this.roleService.getRoles({
            page: this.paginator.pageIndex,
            pageSize: this.paginator.pageSize,
            sortBy: this.sort.active,
            sortDirection: this.sort.direction,
            search: this.searchControl.value || ''
          }).pipe(
            catchError(error => {
              console.error('Error loading roles:', error);
              if (error.status === 403) {
                this.hasPermission = false;
                this.snackBar.open('You do not have permission to view roles', 'Close', { duration: 5000 });
              } else {
                this.snackBar.open('Error loading roles', 'Close', { duration: 3000 });
              }
              return of({ items: [], total: 0, page: 0, pageSize: 10 });
            })
          );
        }),
        map(response => {
          this.loading = false;
          this.totalCount = response.total;
          return response.items;
        })
      )
      .subscribe(data => {
        this.dataSource = data;
      });
  }

  loadRoles(): void {
    if (this.paginator) {
      this.paginator.page.emit();
    }
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
          this.loadRoles();
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