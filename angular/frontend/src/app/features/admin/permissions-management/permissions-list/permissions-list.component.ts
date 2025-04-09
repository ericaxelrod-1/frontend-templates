import { Component, OnInit, ViewChild } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { MatSort } from '@angular/material/sort';
import { MatPaginator } from '@angular/material/paginator';
import { FormControl } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../environments/environment';
import { MatSnackBar } from '@angular/material/snack-bar';

interface Permission {
  id: number;
  resourceName: string;
  actionName: string;
  description: string;
}

@Component({
  selector: 'app-permissions-list',
  template: `
    <div class="permissions-container">
      <div class="header-section">
        <h2>System Permissions</h2>
        <div class="actions">
          <button mat-raised-button color="primary" (click)="createPermission()">
            <mat-icon>add</mat-icon> Create Permission
          </button>
        </div>
      </div>
      
      <mat-form-field appearance="outline" class="filter-field">
        <mat-label>Filter</mat-label>
        <input matInput [formControl]="filterControl" placeholder="Search permissions...">
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>
      
      <div class="table-container mat-elevation-z1">
        <mat-progress-bar *ngIf="loading" mode="indeterminate"></mat-progress-bar>
        
        <table mat-table [dataSource]="dataSource" matSort>
          <!-- ID Column -->
          <ng-container matColumnDef="id">
            <th mat-header-cell *matHeaderCellDef mat-sort-header> ID </th>
            <td mat-cell *matCellDef="let permission"> {{permission.id}} </td>
          </ng-container>
          
          <!-- Resource Column -->
          <ng-container matColumnDef="resourceName">
            <th mat-header-cell *matHeaderCellDef mat-sort-header> Resource </th>
            <td mat-cell *matCellDef="let permission"> {{permission.resourceName}} </td>
          </ng-container>
          
          <!-- Action Column -->
          <ng-container matColumnDef="actionName">
            <th mat-header-cell *matHeaderCellDef mat-sort-header> Action </th>
            <td mat-cell *matCellDef="let permission"> {{permission.actionName}} </td>
          </ng-container>
          
          <!-- Full Permission Column -->
          <ng-container matColumnDef="fullPermission">
            <th mat-header-cell *matHeaderCellDef> Permission </th>
            <td mat-cell *matCellDef="let permission">
              <code>{{permission.resourceName}}:{{permission.actionName}}</code>
            </td>
          </ng-container>
          
          <!-- Description Column -->
          <ng-container matColumnDef="description">
            <th mat-header-cell *matHeaderCellDef mat-sort-header> Description </th>
            <td mat-cell *matCellDef="let permission"> {{permission.description}} </td>
          </ng-container>
          
          <!-- Actions Column -->
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef> Actions </th>
            <td mat-cell *matCellDef="let permission">
              <button mat-icon-button [matMenuTriggerFor]="menu" aria-label="Permission actions">
                <mat-icon>more_vert</mat-icon>
              </button>
              <mat-menu #menu="matMenu">
                <button mat-menu-item (click)="editPermission(permission)">
                  <mat-icon>edit</mat-icon>
                  <span>Edit</span>
                </button>
                <button mat-menu-item (click)="assignPermission(permission)">
                  <mat-icon>assignment_ind</mat-icon>
                  <span>Assign</span>
                </button>
                <button mat-menu-item (click)="deletePermission(permission)">
                  <mat-icon>delete</mat-icon>
                  <span>Delete</span>
                </button>
              </mat-menu>
            </td>
          </ng-container>
          
          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
          
          <!-- No data row -->
          <tr class="mat-row" *matNoDataRow>
            <td class="mat-cell no-data" [attr.colspan]="displayedColumns.length">
              No permissions found
            </td>
          </tr>
        </table>
        
        <mat-paginator [pageSizeOptions]="[10, 25, 50, 100]" showFirstLastButtons></mat-paginator>
      </div>
    </div>
  `,
  styles: [`
    .permissions-container {
      padding: 16px;
    }
    
    .header-section {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    
    .filter-field {
      width: 100%;
      margin-bottom: 16px;
    }
    
    .table-container {
      position: relative;
      min-height: 200px;
      overflow: auto;
    }
    
    table {
      width: 100%;
    }
    
    .mat-column-id {
      width: 5%;
    }
    
    .mat-column-resourceName,
    .mat-column-actionName {
      width: 15%;
    }
    
    .mat-column-fullPermission {
      width: 20%;
    }
    
    .mat-column-description {
      width: 35%;
    }
    
    .mat-column-actions {
      width: 10%;
      text-align: right;
    }
    
    code {
      background-color: #f5f5f5;
      padding: 3px 6px;
      border-radius: 4px;
      font-family: monospace;
    }
    
    .no-data {
      text-align: center;
      padding: 20px 0;
      color: rgba(0, 0, 0, 0.54);
    }
  `]
})
export class PermissionsListComponent implements OnInit {
  displayedColumns: string[] = ['id', 'resourceName', 'actionName', 'fullPermission', 'description', 'actions'];
  dataSource = new MatTableDataSource<Permission>([]);
  filterControl = new FormControl('');
  loading = false;
  
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  
  constructor(
    private http: HttpClient,
    private snackBar: MatSnackBar
  ) {}
  
  ngOnInit() {
    this.loadPermissions();
    
    // Set up filtering
    this.filterControl.valueChanges.subscribe(value => {
      this.dataSource.filter = value?.trim().toLowerCase() || '';
    });
  }
  
  ngAfterViewInit() {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }
  
  loadPermissions() {
    this.loading = true;
    this.http.get<Permission[]>(`${environment.apiUrl}/permissions`)
      .subscribe({
        next: (permissions) => {
          this.dataSource.data = permissions;
          this.loading = false;
        },
        error: (error) => {
          console.error('Error loading permissions:', error);
          this.snackBar.open('Failed to load permissions', 'Close', { duration: 3000 });
          this.loading = false;
        }
      });
  }
  
  createPermission() {
    // Open a dialog to create a new permission
    console.log('Create permission - To be implemented');
    // TODO: Implement permission creation dialog
  }
  
  editPermission(permission: Permission) {
    // Open a dialog to edit the permission
    console.log('Edit permission:', permission);
    // TODO: Implement permission editing dialog
  }
  
  assignPermission(permission: Permission) {
    // Navigate to the permission assignment page
    console.log('Assign permission:', permission);
    // TODO: Implement navigation to permission assignment page
  }
  
  deletePermission(permission: Permission) {
    // Confirm deletion, then delete the permission
    console.log('Delete permission:', permission);
    // TODO: Implement permission deletion confirmation dialog
  }
} 