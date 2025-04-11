import { Component, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { MatSort } from '@angular/material/sort';
import { MatPaginator } from '@angular/material/paginator';
import { FormControl } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../environments/environment';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';

interface ComponentPermission {
  id: string;
  selector: string;
  description: string;
  requiredPermissions: string[];
  overridePermissions: boolean;
  lastSynced: Date;
}

@Component({
  selector: 'app-component-permissions',
  template: `
    <div class="component-permissions-container">
      <div class="header-section">
        <h2>UI Component Permissions</h2>
        <div class="actions">
          <button mat-raised-button color="primary" (click)="refreshComponents()">
            <mat-icon>refresh</mat-icon> Refresh Components
          </button>
        </div>
      </div>
      
      <mat-form-field appearance="outline" class="filter-field">
        <mat-label>Filter</mat-label>
        <input matInput [formControl]="filterControl" placeholder="Search components...">
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>
      
      <div class="table-container mat-elevation-z1">
        <mat-progress-bar *ngIf="loading" mode="indeterminate"></mat-progress-bar>
        
        <table mat-table [dataSource]="dataSource" matSort>
          <!-- Selector Column -->
          <ng-container matColumnDef="selector">
            <th mat-header-cell *matHeaderCellDef mat-sort-header> Selector </th>
            <td mat-cell *matCellDef="let component"> 
              <code>{{component.selector}}</code>
            </td>
          </ng-container>
          
          <!-- Description Column -->
          <ng-container matColumnDef="description">
            <th mat-header-cell *matHeaderCellDef mat-sort-header> Description </th>
            <td mat-cell *matCellDef="let component"> {{component.description}} </td>
          </ng-container>
          
          <!-- Required Permissions Column -->
          <ng-container matColumnDef="requiredPermissions">
            <th mat-header-cell *matHeaderCellDef> Required Permissions </th>
            <td mat-cell *matCellDef="let component">
              <div class="permissions-list">
                <mat-chip-set>
                  <mat-chip *ngFor="let permission of component.requiredPermissions">
                    {{permission}}
                  </mat-chip>
                </mat-chip-set>
                <span *ngIf="!component.requiredPermissions?.length" class="no-permissions">
                  No permissions required
                </span>
              </div>
            </td>
          </ng-container>
          
          <!-- Override Column -->
          <ng-container matColumnDef="overridePermissions">
            <th mat-header-cell *matHeaderCellDef mat-sort-header> Override </th>
            <td mat-cell *matCellDef="let component"> 
              <mat-icon *ngIf="component.overridePermissions" color="accent">check_circle</mat-icon>
              <mat-icon *ngIf="!component.overridePermissions" color="disabled">remove_circle_outline</mat-icon>
            </td>
          </ng-container>
          
          <!-- Last Synced Column -->
          <ng-container matColumnDef="lastSynced">
            <th mat-header-cell *matHeaderCellDef mat-sort-header> Last Synced </th>
            <td mat-cell *matCellDef="let component"> 
              {{component.lastSynced | date:'medium'}}
            </td>
          </ng-container>
          
          <!-- Actions Column -->
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef> Actions </th>
            <td mat-cell *matCellDef="let component">
              <button mat-icon-button [matMenuTriggerFor]="menu" aria-label="Component actions">
                <mat-icon>more_vert</mat-icon>
              </button>
              <mat-menu #menu="matMenu">
                <button mat-menu-item (click)="editComponentPermissions(component)">
                  <mat-icon>edit</mat-icon>
                  <span>Edit Permissions</span>
                </button>
                <button mat-menu-item (click)="toggleOverride(component)">
                  <mat-icon>{{component.overridePermissions ? 'toggle_off' : 'toggle_on'}}</mat-icon>
                  <span>{{component.overridePermissions ? 'Remove Override' : 'Override Permissions'}}</span>
                </button>
                <button mat-menu-item (click)="viewDetails(component)">
                  <mat-icon>visibility</mat-icon>
                  <span>View Details</span>
                </button>
              </mat-menu>
            </td>
          </ng-container>
          
          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
          
          <!-- No data row -->
          <tr class="mat-row" *matNoDataRow>
            <td class="mat-cell no-data" [attr.colspan]="displayedColumns.length">
              No components found
            </td>
          </tr>
        </table>
        
        <mat-paginator [pageSizeOptions]="[10, 25, 50, 100]" showFirstLastButtons></mat-paginator>
      </div>
    </div>
  `,
  styles: [`
    .component-permissions-container {
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
    
    .mat-column-selector {
      width: 20%;
    }
    
    .mat-column-description {
      width: 25%;
    }
    
    .mat-column-requiredPermissions {
      width: 25%;
    }
    
    .mat-column-overridePermissions {
      width: 10%;
      text-align: center;
    }
    
    .mat-column-lastSynced {
      width: 15%;
    }
    
    .mat-column-actions {
      width: 5%;
      text-align: right;
    }
    
    code {
      background-color: #f5f5f5;
      padding: 3px 6px;
      border-radius: 4px;
      font-family: monospace;
    }
    
    .permissions-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    
    .no-permissions {
      color: rgba(0, 0, 0, 0.54);
      font-style: italic;
    }
    
    .no-data {
      text-align: center;
      padding: 20px 0;
      color: rgba(0, 0, 0, 0.54);
    }
  `]
})
export class ComponentPermissionsComponent implements OnInit, AfterViewInit {
  displayedColumns: string[] = ['selector', 'description', 'requiredPermissions', 'overridePermissions', 'lastSynced', 'actions'];
  dataSource = new MatTableDataSource<ComponentPermission>([]);
  filterControl = new FormControl('');
  loading = false;
  
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  
  constructor(
    private http: HttpClient,
    private snackBar: MatSnackBar,
    private router: Router
  ) {}
  
  ngOnInit() {
    this.loadComponents();
    
    // Set up filtering
    this.filterControl.valueChanges.subscribe(value => {
      this.dataSource.filter = value?.trim().toLowerCase() || '';
    });
  }
  
  ngAfterViewInit() {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }
  
  loadComponents() {
    this.loading = true;
    this.http.get<ComponentPermission[]>(`${environment.apiUrl}/permissions/components`)
      .subscribe({
        next: (components) => {
          this.dataSource.data = components;
          this.loading = false;
        },
        error: (error) => {
          console.error('Error loading components:', error);
          this.snackBar.open('Failed to load components', 'Close', { duration: 3000 });
          this.loading = false;
        }
      });
  }
  
  refreshComponents() {
    this.loading = true;
    this.http.post<{ message: string }>(`${environment.apiUrl}/permissions/sync`, { type: 'components' })
      .subscribe({
        next: (response) => {
          this.snackBar.open(response.message, 'Close', { duration: 3000 });
          this.loadComponents();
        },
        error: (error) => {
          console.error('Error refreshing components:', error);
          this.snackBar.open('Failed to refresh components', 'Close', { duration: 3000 });
          this.loading = false;
        }
      });
  }
  
  editComponentPermissions(component: ComponentPermission) {
    // Navigate to permission assignment for this component
    this.router.navigate(['/admin/permissions/assign/component', component.id]);
  }
  
  toggleOverride(component: ComponentPermission) {
    this.loading = true;
    this.http.patch<ComponentPermission>(
      `${environment.apiUrl}/permissions/components/${component.id}`,
      { overridePermissions: !component.overridePermissions }
    ).subscribe({
      next: (updatedComponent) => {
        // Update the component in the data source
        const data = this.dataSource.data;
        const index = data.findIndex(c => c.id === component.id);
        if (index !== -1) {
          data[index] = updatedComponent;
          this.dataSource.data = [...data];
        }
        
        this.snackBar.open('Component permissions override updated', 'Close', { duration: 3000 });
        this.loading = false;
      },
      error: (error) => {
        console.error('Error updating component:', error);
        this.snackBar.open('Failed to update component', 'Close', { duration: 3000 });
        this.loading = false;
      }
    });
  }
  
  viewDetails(component: ComponentPermission) {
    // Show a dialog with component details
    console.log('View component details:', component);
    // TODO: Implement component details dialog
  }
} 