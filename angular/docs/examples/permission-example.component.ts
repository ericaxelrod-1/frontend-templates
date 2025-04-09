import { Component, OnInit } from '@angular/core';
import { PermissionService } from '../../../app/core/services/permission.service';
import { Observable, forkJoin, map } from 'rxjs';

@Component({
  selector: 'app-resource-list',
  template: `
    <div class="container">
      <h1>Resource Management</h1>
      
      <!-- Example of static permission checks -->
      <div class="actions-bar">
        <!-- Only show if user has permission -->
        <button 
          class="btn btn-primary" 
          *appHasPermission="'resources:create'"
          (click)="createResource()">
          Create Resource
        </button>
        
        <!-- Alternative syntax -->
        <button 
          class="btn btn-secondary" 
          *appHasPermission="{ resource: 'resources', action: 'export' }"
          (click)="exportResources()">
          Export All
        </button>
        
        <!-- With else template -->
        <button 
          class="btn btn-danger" 
          *appHasPermission="'resources:delete'; else deleteDisabled"
          (click)="deleteSelected()">
          Delete Selected
        </button>
        <ng-template #deleteDisabled>
          <button class="btn btn-danger" disabled tooltip="You need delete permission">
            Delete Selected
          </button>
        </ng-template>
      </div>
      
      <!-- Table of resources -->
      <table class="table table-striped">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Description</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let resource of resources">
            <td>{{ resource.id }}</td>
            <td>{{ resource.name }}</td>
            <td>{{ resource.description }}</td>
            <td class="action-buttons">
              <!-- View button - requires read permission -->
              <button 
                class="btn btn-sm btn-info" 
                *appHasPermission="'resources:read'"
                (click)="viewResource(resource.id)">
                View
              </button>
              
              <!-- Edit button - requires update permission -->
              <button 
                class="btn btn-sm btn-warning" 
                *appHasPermission="'resources:update'"
                (click)="editResource(resource.id)">
                Edit
              </button>
              
              <!-- Delete button - requires delete permission -->
              <button 
                class="btn btn-sm btn-danger" 
                *appHasPermission="'resources:delete'"
                (click)="confirmDelete(resource.id)">
                Delete
              </button>
              
              <!-- Analytics button - requires BOTH read AND analytics access -->
              <button 
                class="btn btn-sm btn-primary" 
                *ngIf="canViewAnalytics(resource.id) | async"
                (click)="viewAnalytics(resource.id)">
                Analytics
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      
      <!-- Admin panel - requires admin permission -->
      <div class="admin-panel" *appHasPermission="'admin:access'">
        <h3>Administration Panel</h3>
        <div class="card">
          <div class="card-body">
            <h5 class="card-title">Resource Management</h5>
            <p class="card-text">Advanced options for resource management.</p>
            <button class="btn btn-outline-primary" (click)="openBulkOperations()">Bulk Operations</button>
            <button class="btn btn-outline-secondary" (click)="openPermissionSettings()">Permission Settings</button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .actions-bar {
      margin-bottom: 20px;
    }
    .actions-bar button {
      margin-right: 10px;
    }
    .action-buttons button {
      margin-right: 5px;
    }
    .admin-panel {
      margin-top: 30px;
      padding: 15px;
      background-color: #f8f9fa;
      border-radius: 5px;
    }
  `]
})
export class ResourceListComponent implements OnInit {
  resources = [
    { id: 1, name: 'Resource 1', description: 'First sample resource' },
    { id: 2, name: 'Resource 2', description: 'Second sample resource' },
    { id: 3, name: 'Resource 3', description: 'Third sample resource' },
  ];

  constructor(private permissionService: PermissionService) {}

  ngOnInit(): void {
    // Load any necessary data
  }

  // Example methods that would be implemented in a real component
  createResource(): void {
    console.log('Creating new resource');
  }

  exportResources(): void {
    console.log('Exporting resources');
  }

  deleteSelected(): void {
    console.log('Deleting selected resources');
  }

  viewResource(id: number): void {
    console.log(`Viewing resource ${id}`);
  }

  editResource(id: number): void {
    console.log(`Editing resource ${id}`);
  }

  confirmDelete(id: number): void {
    console.log(`Confirming deletion of resource ${id}`);
  }

  viewAnalytics(id: number): void {
    console.log(`Viewing analytics for resource ${id}`);
  }

  openBulkOperations(): void {
    console.log('Opening bulk operations dialog');
  }

  openPermissionSettings(): void {
    console.log('Opening permission settings dialog');
  }

  /**
   * Example of programmatic permission check for complex conditions
   * Checks if user has both resource:read AND analytics:access permissions
   */
  canViewAnalytics(resourceId: number): Observable<boolean> {
    // Check for both required permissions
    return forkJoin([
      this.permissionService.hasPermission('resources', 'read'),
      this.permissionService.hasPermission('analytics', 'access')
    ]).pipe(
      map(([canReadResource, canAccessAnalytics]) => canReadResource && canAccessAnalytics)
    );
  }
} 