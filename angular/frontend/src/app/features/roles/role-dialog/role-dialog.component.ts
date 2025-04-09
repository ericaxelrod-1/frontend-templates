import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Role, Permission, PermissionObject, RoleService } from '../../../services/role.service';

// Interface to group permissions by resource
interface PermissionGroup {
  resource: string;
  permissions: Permission[];
}

@Component({
  selector: 'app-role-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatChipsModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatTooltipModule
  ],
  template: `
    <h2 mat-dialog-title>{{ data.role ? 'Edit Role' : 'Create Role' }}</h2>
    <mat-dialog-content>
      <form #roleForm="ngForm">
        <mat-form-field appearance="fill" class="full-width">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="role.name" name="name" required>
        </mat-form-field>

        <mat-form-field appearance="fill" class="full-width">
          <mat-label>Description</mat-label>
          <textarea matInput [(ngModel)]="role.description" name="description" rows="3"></textarea>
        </mat-form-field>

        <div class="permissions-section">
          <h3>Permissions</h3>
          
          <!-- Select all checkbox -->
          <div class="select-all">
            <mat-checkbox 
              [checked]="areAllPermissionsSelected()" 
              [indeterminate]="areSomePermissionsSelected()"
              (change)="toggleAllPermissions($event.checked)">
              Select All Permissions
            </mat-checkbox>
          </div>
          
          <!-- Grouped permissions accordion -->
          <div class="permissions-accordion">
            <mat-accordion>
              <mat-expansion-panel *ngFor="let group of permissionGroups">
                <mat-expansion-panel-header>
                  <mat-panel-title>
                    {{ group.resource | titlecase }} Permissions
                  </mat-panel-title>
                  <mat-panel-description>
                    {{ getSelectedPermissionCountForResource(group.resource) }}/{{ group.permissions.length }} selected
                  </mat-panel-description>
                </mat-expansion-panel-header>
                
                <!-- Resource-level select all -->
                <div class="resource-select-all">
                  <mat-checkbox 
                    [checked]="areAllResourcePermissionsSelected(group.resource)" 
                    [indeterminate]="areSomeResourcePermissionsSelected(group.resource)"
                    (change)="toggleResourcePermissions(group.resource, $event.checked)">
                    Select All {{ group.resource | titlecase }} Permissions
                  </mat-checkbox>
                </div>
                
                <!-- Individual permissions -->
                <div class="permissions-grid">
                  <div *ngFor="let permission of group.permissions" class="permission-item">
                    <mat-checkbox 
                      [checked]="isPermissionSelected(permission)" 
                      (change)="togglePermission(permission, $event.checked)">
                      {{ formatPermissionName(permission) }}
                    </mat-checkbox>
                    <div class="permission-description" 
                         [matTooltip]="permission.description">
                      {{ permission.description }}
                    </div>
                  </div>
                </div>
              </mat-expansion-panel>
            </mat-accordion>
          </div>
        </div>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button mat-raised-button color="primary" (click)="onSave()" [disabled]="!roleForm.form.valid">
        {{ data.role ? 'Save' : 'Create' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width {
      width: 100%;
      margin-bottom: 16px;
    }

    mat-dialog-content {
      min-width: 500px;
      max-height: 70vh;
    }

    textarea {
      resize: vertical;
    }
    
    .permissions-section {
      margin-top: 16px;
    }
    
    .select-all {
      margin-bottom: 16px;
    }
    
    .resource-select-all {
      margin-bottom: 12px;
    }
    
    .permissions-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    
    .permission-item {
      padding: 8px;
      border-radius: 4px;
      background-color: #f5f5f5;
    }
    
    .permission-description {
      margin-top: 4px;
      font-size: 12px;
      color: rgba(0, 0, 0, 0.6);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .permissions-accordion {
      margin-top: 16px;
    }
  `]
})
export class RoleDialogComponent implements OnInit {
  role: Partial<Role>;
  availablePermissions: Permission[] = [];
  permissionGroups: PermissionGroup[] = [];
  permissionsObject: PermissionObject = {};

  constructor(
    public dialogRef: MatDialogRef<RoleDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { role?: Role },
    private roleService: RoleService
  ) {
    this.role = data.role ? { ...data.role } : {
      name: '',
      description: '',
      permissions: {} as PermissionObject
    };
    
    // Convert array permissions to object if needed
    if (data.role && Array.isArray(data.role.permissions)) {
      this.permissionsObject = {};
      (data.role.permissions as Permission[]).forEach(permission => {
        this.permissionsObject[permission.id] = true;
      });
      this.role.permissions = this.permissionsObject;
    } else if (data.role && data.role.permissions) {
      this.permissionsObject = { ...(data.role.permissions as PermissionObject) };
    }
  }

  ngOnInit(): void {
    this.loadPermissions();
  }

  loadPermissions(): void {
    this.roleService.getPermissions().subscribe({
      next: (permissions) => {
        this.availablePermissions = permissions;
        this.groupPermissionsByResource();
      },
      error: (error) => {
        console.error('Error loading permissions:', error);
      }
    });
  }

  /**
   * Group permissions by resource type
   */
  groupPermissionsByResource(): void {
    // Create a map of resource to permissions
    const groupMap = new Map<string, Permission[]>();
    
    this.availablePermissions.forEach(permission => {
      // Extract resource from permission id (format: 'resource:action')
      const resource = this.getResourceFromPermission(permission);
      
      if (!groupMap.has(resource)) {
        groupMap.set(resource, []);
      }
      
      groupMap.get(resource)?.push(permission);
    });
    
    // Convert map to array for template
    this.permissionGroups = Array.from(groupMap.entries())
      .map(([resource, permissions]) => ({ resource, permissions }))
      .sort((a, b) => a.resource.localeCompare(b.resource));
  }

  /**
   * Extract resource part from permission
   */
  getResourceFromPermission(permission: Permission): string {
    // Handle both id format (resource:action) and name format
    const id = permission.id || permission.name;
    if (id && id.includes(':')) {
      return id.split(':')[0];
    }
    return 'other';
  }

  /**
   * Format permission name for display
   */
  formatPermissionName(permission: Permission): string {
    // If permission.id is in resource:action format, use that
    if (permission.id && permission.id.includes(':')) {
      return permission.id;
    }
    // Otherwise fall back to name
    return permission.name;
  }

  /**
   * Check if a specific permission is selected
   */
  isPermissionSelected(permission: Permission): boolean {
    return Boolean(this.permissionsObject[permission.id]);
  }

  /**
   * Toggle a permission selection
   */
  togglePermission(permission: Permission, isChecked: boolean): void {
    this.permissionsObject[permission.id] = isChecked;
    this.role.permissions = this.permissionsObject;
  }

  /**
   * Toggle all permissions for a resource
   */
  toggleResourcePermissions(resource: string, isChecked: boolean): void {
    const resourcePermissions = this.permissionGroups
      .find(group => group.resource === resource)?.permissions || [];
      
    resourcePermissions.forEach(permission => {
      this.permissionsObject[permission.id] = isChecked;
    });
    
    this.role.permissions = this.permissionsObject;
  }

  /**
   * Toggle all permissions
   */
  toggleAllPermissions(isChecked: boolean): void {
    this.availablePermissions.forEach(permission => {
      this.permissionsObject[permission.id] = isChecked;
    });
    this.role.permissions = this.permissionsObject;
  }

  /**
   * Check if all permissions are selected
   */
  areAllPermissionsSelected(): boolean {
    return this.availablePermissions.length > 0 && 
      this.availablePermissions.every(p => this.permissionsObject[p.id]);
  }

  /**
   * Check if some but not all permissions are selected
   */
  areSomePermissionsSelected(): boolean {
    const selectedCount = this.availablePermissions.filter(p => this.permissionsObject[p.id]).length;
    return selectedCount > 0 && selectedCount < this.availablePermissions.length;
  }

  /**
   * Check if all permissions for a specific resource are selected
   */
  areAllResourcePermissionsSelected(resource: string): boolean {
    const resourcePermissions = this.permissionGroups
      .find(group => group.resource === resource)?.permissions || [];
      
    return resourcePermissions.length > 0 && 
      resourcePermissions.every(p => this.permissionsObject[p.id]);
  }

  /**
   * Check if some but not all permissions for a specific resource are selected
   */
  areSomeResourcePermissionsSelected(resource: string): boolean {
    const resourcePermissions = this.permissionGroups
      .find(group => group.resource === resource)?.permissions || [];
      
    const selectedCount = resourcePermissions.filter(p => this.permissionsObject[p.id]).length;
    return selectedCount > 0 && selectedCount < resourcePermissions.length;
  }

  /**
   * Get the count of selected permissions for a resource
   */
  getSelectedPermissionCountForResource(resource: string): number {
    const resourcePermissions = this.permissionGroups
      .find(group => group.resource === resource)?.permissions || [];
      
    return resourcePermissions.filter(p => this.permissionsObject[p.id]).length;
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    // Ensure permissions is properly set
    this.role.permissions = this.permissionsObject;
    this.dialogRef.close(this.role);
  }
} 