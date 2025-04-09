import { Component, OnInit, ViewChild } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { MatSort } from '@angular/material/sort';
import { MatPaginator } from '@angular/material/paginator';
import { FormControl } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../environments/environment';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';

interface EndpointPermission {
  id: string;
  path: string;
  method: string;
  description: string;
  requiredPermissions: string[];
  overridePermissions: boolean;
  lastSynced: Date;
}

@Component({
  selector: 'app-endpoint-permissions',
  templateUrl: './endpoint-permissions.component.html',
  styleUrls: ['./endpoint-permissions.component.scss']
})
export class EndpointPermissionsComponent implements OnInit {
  displayedColumns: string[] = ['method', 'path', 'description', 'requiredPermissions', 'overridePermissions', 'actions'];
  dataSource = new MatTableDataSource<EndpointPermission>([]);
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
    this.loadEndpoints();
    
    // Set up filtering
    this.filterControl.valueChanges.subscribe(value => {
      this.dataSource.filter = value?.trim().toLowerCase() || '';
    });
    
    // Set up custom filtering
    this.dataSource.filterPredicate = (data: EndpointPermission, filter: string) => {
      const searchStr = (data.path + data.method + data.description + (data.requiredPermissions || []).join(' ')).toLowerCase();
      return searchStr.includes(filter);
    };
  }
  
  ngAfterViewInit() {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }
  
  loadEndpoints() {
    this.loading = true;
    this.http.get<EndpointPermission[]>(`${environment.apiUrl}/permissions/endpoints`)
      .subscribe({
        next: (endpoints) => {
          this.dataSource.data = endpoints;
          this.loading = false;
        },
        error: (error) => {
          console.error('Error loading endpoints:', error);
          this.snackBar.open('Failed to load endpoints', 'Close', { duration: 3000 });
          this.loading = false;
        }
      });
  }
  
  refreshEndpoints() {
    this.loading = true;
    this.http.post<{ message: string }>(`${environment.apiUrl}/permissions/sync`, { type: 'endpoints' })
      .subscribe({
        next: (response) => {
          this.snackBar.open(response.message, 'Close', { duration: 3000 });
          this.loadEndpoints();
        },
        error: (error) => {
          console.error('Error refreshing endpoints:', error);
          this.snackBar.open('Failed to refresh endpoints', 'Close', { duration: 3000 });
          this.loading = false;
        }
      });
  }
  
  editEndpointPermissions(endpoint: EndpointPermission) {
    // Navigate to permission assignment for this endpoint
    this.router.navigate(['/admin/permissions/assign/endpoint', endpoint.id]);
  }
  
  toggleOverride(endpoint: EndpointPermission) {
    this.loading = true;
    this.http.patch<EndpointPermission>(
      `${environment.apiUrl}/permissions/endpoints/${endpoint.id}`,
      { overridePermissions: !endpoint.overridePermissions }
    ).subscribe({
      next: (updatedEndpoint) => {
        // Update the endpoint in the data source
        const data = this.dataSource.data;
        const index = data.findIndex(e => e.id === endpoint.id);
        if (index !== -1) {
          data[index] = updatedEndpoint;
          this.dataSource.data = [...data];
        }
        
        this.snackBar.open('Endpoint permissions override updated', 'Close', { duration: 3000 });
        this.loading = false;
      },
      error: (error) => {
        console.error('Error updating endpoint:', error);
        this.snackBar.open('Failed to update endpoint', 'Close', { duration: 3000 });
        this.loading = false;
      }
    });
  }
  
  testEndpoint(endpoint: EndpointPermission) {
    // Test if the current user can access this endpoint
    this.http.get<{ hasAccess: boolean }>(`${environment.apiUrl}/permissions/endpoint-access-test/${endpoint.id}`)
      .subscribe({
        next: (result) => {
          if (result.hasAccess) {
            this.snackBar.open('You have permission to access this endpoint', 'Close', {
              duration: 3000,
              panelClass: 'success-snackbar'
            });
          } else {
            this.snackBar.open('You do not have permission to access this endpoint', 'Close', {
              duration: 3000,
              panelClass: 'warning-snackbar'
            });
          }
        },
        error: (error) => {
          console.error('Error testing endpoint access:', error);
          this.snackBar.open('Failed to test endpoint access', 'Close', { duration: 3000 });
        }
      });
  }
} 