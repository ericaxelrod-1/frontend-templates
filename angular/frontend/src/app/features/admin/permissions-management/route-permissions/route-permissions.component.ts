import { Component, OnInit, ViewChild } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { MatSort } from '@angular/material/sort';
import { MatPaginator } from '@angular/material/paginator';
import { FormControl } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../environments/environment';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';

interface RoutePermission {
  id: string;
  path: string;
  description: string;
  requiredPermissions: string[];
  overridePermissions: boolean;
  lastSynced: Date;
}

@Component({
  selector: 'app-route-permissions',
  template: `
    <div class="route-permissions-container">
      <div class="header-section">
        <h2>Route Permissions</h2>
        <div class="actions">
          <button mat-raised-button color="primary" (click)="refreshRoutes()">
            <mat-icon>refresh</mat-icon> Refresh Routes
          </button>
        </div>
      </div>
      
      <mat-form-field appearance="outline" class="filter-field">
        <mat-label>Filter</mat-label>
        <input matInput [formControl]="filterControl" placeholder="Search routes...">
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>
      
      <div class="table-container mat-elevation-z1">
        <mat-progress-bar *ngIf="loading" mode="indeterminate"></mat-progress-bar>
        
        <table mat-table [dataSource]="dataSource" matSort>
          <!-- Path Column -->
          <ng-container matColumnDef="path">
            <th mat-header-cell *matHeaderCellDef mat-sort-header> Path </th>
            <td mat-cell *matCellDef="let route"> 
              <code>{{route.path}}</code>
            </td>
          </ng-container>
          
          <!-- Description Column -->
          <ng-container matColumnDef="description">
            <th mat-header-cell *matHeaderCellDef mat-sort-header> Description </th>
            <td mat-cell *matCellDef="let route"> {{route.description}} </td>
          </ng-container>
          
          <!-- Required Permissions Column -->
          <ng-container matColumnDef="requiredPermissions">
            <th mat-header-cell *matHeaderCellDef> Required Permissions </th>
            <td mat-cell *matCellDef="let route">
              <div class="permissions-list">
                <mat-chip-set>
                  <mat-chip *ngFor="let permission of route.requiredPermissions">
                    {{permission}}
                  </mat-chip>
                </mat-chip-set>
                <span *ngIf="!route.requiredPermissions?.length" class="no-permissions">
                  No permissions required
                </span>
              </div>
            </td>
          </ng-container>
          
          <!-- Override Column -->
          <ng-container matColumnDef="overridePermissions">
            <th mat-header-cell *matHeaderCellDef mat-sort-header> Override </th>
            <td mat-cell *matCellDef="let route"> 
              <mat-icon *ngIf="route.overridePermissions" color="accent">check_circle</mat-icon>
              <mat-icon *ngIf="!route.overridePermissions" color="disabled">remove_circle_outline</mat-icon>
            </td>
          </ng-container>
          
          <!-- Last Synced Column -->
          <ng-container matColumnDef="lastSynced">
            <th mat-header-cell *matHeaderCellDef mat-sort-header> Last Synced </th>
            <td mat-cell *matCellDef="let route"> 
              {{route.lastSynced | date:'medium'}}
            </td>
          </ng-container>
          
          <!-- Actions Column -->
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef> Actions </th>
            <td mat-cell *matCellDef="let route">
              <button mat-icon-button [matMenuTriggerFor]="menu" aria-label="Route actions">
                <mat-icon>more_vert</mat-icon>
              </button>
              <mat-menu #menu="matMenu">
                <button mat-menu-item (click)="editRoutePermissions(route)">
                  <mat-icon>edit</mat-icon>
                  <span>Edit Permissions</span>
                </button>
                <button mat-menu-item (click)="toggleOverride(route)">
                  <mat-icon>{{route.overridePermissions ? 'toggle_off' : 'toggle_on'}}</mat-icon>
                  <span>{{route.overridePermissions ? 'Remove Override' : 'Override Permissions'}}</span>
                </button>
                <button mat-menu-item (click)="testRoute(route)">
                  <mat-icon>play_arrow</mat-icon>
                  <span>Test Route</span>
                </button>
              </mat-menu>
            </td>
          </ng-container>
          
          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
          
          <!-- No data row -->
          <tr class="mat-row" *matNoDataRow>
            <td class="mat-cell no-data" [attr.colspan]="displayedColumns.length">
              No routes found
            </td>
          </tr>
        </table>
        
        <mat-paginator [pageSizeOptions]="[10, 25, 50, 100]" showFirstLastButtons></mat-paginator>
      </div>
    </div>
  `,
  styles: [`
    .route-permissions-container {
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
    
    .mat-column-path {
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
export class RoutePermissionsComponent implements OnInit {
  displayedColumns: string[] = ['path', 'description', 'requiredPermissions', 'overridePermissions', 'lastSynced', 'actions'];
  dataSource = new MatTableDataSource<RoutePermission>([]);
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
    this.loadRoutes();
    
    // Set up filtering
    this.filterControl.valueChanges.subscribe(value => {
      this.dataSource.filter = value?.trim().toLowerCase() || '';
    });
  }
  
  ngAfterViewInit() {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }
  
  loadRoutes() {
    this.loading = true;
    this.http.get<RoutePermission[]>(`${environment.apiUrl}/permissions/routes`)
      .subscribe({
        next: (routes) => {
          this.dataSource.data = routes;
          this.loading = false;
        },
        error: (error) => {
          console.error('Error loading routes:', error);
          this.snackBar.open('Failed to load routes', 'Close', { duration: 3000 });
          this.loading = false;
        }
      });
  }
  
  refreshRoutes() {
    this.loading = true;
    this.http.post<{ message: string }>(`${environment.apiUrl}/permissions/sync`, { type: 'routes' })
      .subscribe({
        next: (response) => {
          this.snackBar.open(response.message, 'Close', { duration: 3000 });
          this.loadRoutes();
        },
        error: (error) => {
          console.error('Error refreshing routes:', error);
          this.snackBar.open('Failed to refresh routes', 'Close', { duration: 3000 });
          this.loading = false;
        }
      });
  }
  
  editRoutePermissions(route: RoutePermission) {
    // Navigate to permission assignment for this route
    this.router.navigate(['/admin/permissions/assign/route', route.id]);
  }
  
  toggleOverride(route: RoutePermission) {
    this.loading = true;
    this.http.patch<RoutePermission>(
      `${environment.apiUrl}/permissions/routes/${route.id}`,
      { overridePermissions: !route.overridePermissions }
    ).subscribe({
      next: (updatedRoute) => {
        // Update the route in the data source
        const data = this.dataSource.data;
        const index = data.findIndex(r => r.id === route.id);
        if (index !== -1) {
          data[index] = updatedRoute;
          this.dataSource.data = [...data];
        }
        
        this.snackBar.open('Route permissions override updated', 'Close', { duration: 3000 });
        this.loading = false;
      },
      error: (error) => {
        console.error('Error updating route:', error);
        this.snackBar.open('Failed to update route', 'Close', { duration: 3000 });
        this.loading = false;
      }
    });
  }
  
  testRoute(route: RoutePermission) {
    // Test if the current user can access this route
    this.http.get<{ hasAccess: boolean }>(`${environment.apiUrl}/permissions/route-access-test/${route.id}`)
      .subscribe({
        next: (result) => {
          if (result.hasAccess) {
            this.snackBar.open('You have permission to access this route', 'Close', {
              duration: 3000,
              panelClass: 'success-snackbar'
            });
          } else {
            this.snackBar.open('You do not have permission to access this route', 'Close', {
              duration: 3000,
              panelClass: 'warning-snackbar'
            });
          }
        },
        error: (error) => {
          console.error('Error testing route access:', error);
          this.snackBar.open('Failed to test route access', 'Close', { duration: 3000 });
        }
      });
  }
} 