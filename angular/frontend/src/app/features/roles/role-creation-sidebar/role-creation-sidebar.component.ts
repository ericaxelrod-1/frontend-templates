import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Role, Permission, RoleService } from '../../../services/role.service';
import { SidePanelRef, SIDE_PANEL_DATA } from '../../../shared/components/side-panel';

export interface RoleCreationPanelData {
  roleData: Role | null;
}

// Interface to group permissions by resource
interface PermissionGroup {
  resource: string;
  permissions: Permission[];
}

@Component({
  selector: 'app-role-creation-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDividerModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatTooltipModule
  ],
  template: `
    <div class="sidebar-content">
      <!-- Header -->
      <div class="sidebar-header">
        <div class="header-content">
          <h2>{{ editMode ? 'Edit Role' : 'Create Role' }}</h2>
          <p>{{ editMode ? 'Modify role details and permissions' : 'Set up a new role with permissions' }}</p>
        </div>
        <button mat-icon-button class="close-button" (click)="onCloseSidebar()">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      
      <!-- Form Section -->
      <div class="form-section">
        <form #roleForm="ngForm" class="role-form">
          <!-- Basic Information -->
          <div class="basic-info-section">
            <h3>Basic Information</h3>
            
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Role Name</mat-label>
              <input matInput 
                     [(ngModel)]="formData.name" 
                     name="name" 
                     required
                     placeholder="Enter role name">
              <mat-error *ngIf="!formData.name?.trim()">Role name is required</mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Description</mat-label>
              <textarea matInput 
                        [(ngModel)]="formData.description" 
                        name="description"
                        rows="3"
                        placeholder="Enter role description">
              </textarea>
            </mat-form-field>
          </div>

          <mat-divider></mat-divider>

          <!-- Permissions Section -->
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
          
          <!-- Form Validation -->
          <div class="form-validation" *ngIf="!formData.name?.trim()">
            <mat-icon class="warning-icon">warning</mat-icon>
            <span>Role name is required</span>
          </div>
          
          <!-- Action Buttons -->
          <div class="action-buttons">
            <button mat-button 
                    class="cancel-button"
                    (click)="onCloseSidebar()">
              Cancel
            </button>
            <button mat-raised-button 
                    color="primary"
                    class="save-button"
                    [disabled]="!formData.name?.trim()"
                    (click)="onSave()">
              {{ editMode ? 'Update Role' : 'Create Role' }}
            </button>
          </div>
        </form>
      </div>
      
      <!-- Spacer for better scrolling -->
      <div class="bottom-spacer"></div>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow-y: auto;
    }
    
    .sidebar-content {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    
    .sidebar-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 20px;
      border-bottom: 1px solid #e0e0e0;
      background-color: #fafafa;
    }
    
    .header-content h2 {
      margin: 0 0 8px 0;
      font-size: 24px;
      font-weight: 500;
    }
    
    .header-content p {
      margin: 0;
      color: #666;
      font-size: 14px;
    }
    
    .close-button {
      margin-top: -8px;
      margin-right: -8px;
    }
    
    .form-section {
      flex: 1;
      padding: 20px;
    }
    
    .basic-info-section {
      margin-bottom: 24px;
    }
    
    .basic-info-section h3 {
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 500;
    }
    
    .full-width {
      width: 100%;
      margin-bottom: 16px;
    }
    
    .permissions-section {
      margin-top: 24px;
    }
    
    .permissions-section h3 {
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 500;
    }
    
    .select-all {
      margin-bottom: 16px;
      padding: 12px;
      background-color: #f5f5f5;
      border-radius: 4px;
    }
    
    .permissions-accordion {
      margin-bottom: 24px;
    }
    
    .resource-select-all {
      margin-bottom: 16px;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    
    .permissions-grid {
      display: grid;
      gap: 12px;
    }
    
    .permission-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    
    .permission-description {
      font-size: 12px;
      color: #666;
      margin-left: 32px;
    }
    
    .form-validation {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #f44336;
      font-size: 14px;
      margin-bottom: 16px;
    }
    
    .warning-icon {
      font-size: 18px;
    }
    
    .action-buttons {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      padding-top: 16px;
      border-top: 1px solid #e0e0e0;
    }
    
    .cancel-button {
      min-width: 100px;
    }
    
    .save-button {
      min-width: 120px;
    }
    
    .bottom-spacer {
      height: 20px;
    }
  `]
})
export class RoleCreationSidebarComponent implements OnInit {
  roleData: Role | null = null;
  editMode = false;
  formData: Partial<Role> = {
    name: '',
    description: '',
    permissions: []
  };

  availablePermissions: Permission[] = [];
  permissionGroups: PermissionGroup[] = [];
  selectedPermissions: Set<number> = new Set();

  constructor(
    private roleService: RoleService,
    private sidePanelRef: SidePanelRef,
    @Inject(SIDE_PANEL_DATA) public panelData: RoleCreationPanelData
  ) {
    this.roleData = panelData.roleData;
    this.editMode = !!this.roleData;
    this.resetForm();
  }

  ngOnInit(): void {
    this.loadPermissions();
  }

  private resetForm(): void {
    if (this.editMode && this.roleData) {
      // Edit mode - populate with existing data
      this.formData = {
        name: this.roleData.name || '',
        description: this.roleData.description || '',
        permissions: this.roleData.permissions || []
      };

      // Initialize selected permissions from role
      if (this.roleData.permissions) {
        this.selectedPermissions = new Set(this.roleData.permissions.map(p => p.id));
      }
    } else {
      // Create mode - reset to empty
      this.formData = {
        name: '',
        description: '',
        permissions: []
      };
      this.selectedPermissions = new Set();
    }
  }

  loadPermissions(): void {
    this.roleService.getPermissions().subscribe({
      next: (permissions: Permission[]) => {
        this.availablePermissions = permissions;
        this.groupPermissionsByResource();
      },
      error: (error: Error) => {
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
      // Extract resource from permission name (format: 'resource:action')
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
    // Use permission.name which is in format 'resource:action'
    if (permission.name && permission.name.includes(':')) {
      return permission.name.split(':')[0];
    }
    // Fallback to resourceName if available
    if (permission.resourceName) {
      return permission.resourceName;
    }
    return 'other';
  }

  /**
   * Format permission name for display
   */
  formatPermissionName(permission: Permission): string {
    // Use permission.name which is the formatted permission string
    return permission.name || `${permission.resourceName}:${permission.actionName}`;
  }

  /**
   * Check if a specific permission is selected
   */
  isPermissionSelected(permission: Permission): boolean {
    return this.selectedPermissions.has(permission.id);
  }

  /**
   * Toggle a permission selection
   */
  togglePermission(permission: Permission, isChecked: boolean): void {
    if (isChecked) {
      this.selectedPermissions.add(permission.id);
    } else {
      this.selectedPermissions.delete(permission.id);
    }
  }

  /**
   * Toggle all permissions for a resource
   */
  toggleResourcePermissions(resource: string, isChecked: boolean): void {
    const resourcePermissions = this.permissionGroups
      .find(group => group.resource === resource)
      ?.permissions || [];

    resourcePermissions.forEach(permission => {
      if (isChecked) {
        this.selectedPermissions.add(permission.id);
      } else {
        this.selectedPermissions.delete(permission.id);
      }
    });
  }

  /**
   * Toggle all permissions
   */
  toggleAllPermissions(isChecked: boolean): void {
    this.availablePermissions.forEach(permission => {
      if (isChecked) {
        this.selectedPermissions.add(permission.id);
      } else {
        this.selectedPermissions.delete(permission.id);
      }
    });
  }

  /**
   * Check if all permissions are selected
   */
  areAllPermissionsSelected(): boolean {
    return this.availablePermissions.length > 0 &&
      this.availablePermissions.every(p => this.selectedPermissions.has(p.id));
  }

  /**
   * Check if some but not all permissions are selected
   */
  areSomePermissionsSelected(): boolean {
    return this.availablePermissions.some(p => this.selectedPermissions.has(p.id)) &&
      !this.areAllPermissionsSelected();
  }

  /**
   * Check if all permissions for a specific resource are selected
   */
  areAllResourcePermissionsSelected(resource: string): boolean {
    const resourcePermissions = this.permissionGroups
      .find(group => group.resource === resource)
      ?.permissions || [];

    return resourcePermissions.length > 0 &&
      resourcePermissions.every(p => this.selectedPermissions.has(p.id));
  }

  /**
   * Check if some but not all permissions for a specific resource are selected
   */
  areSomeResourcePermissionsSelected(resource: string): boolean {
    const resourcePermissions = this.permissionGroups
      .find(group => group.resource === resource)
      ?.permissions || [];

    return resourcePermissions.some(p => this.selectedPermissions.has(p.id)) &&
      !this.areAllResourcePermissionsSelected(resource);
  }

  /**
   * Get the count of selected permissions for a resource
   */
  getSelectedPermissionCountForResource(resource: string): number {
    const resourcePermissions = this.permissionGroups
      .find(group => group.resource === resource)
      ?.permissions || [];

    return resourcePermissions.filter(p => this.selectedPermissions.has(p.id)).length;
  }

  onCloseSidebar(): void {
    this.sidePanelRef.close();
  }

  onSave(): void {
    if (this.formData.name && this.formData.name.trim()) {
      // Convert selected permission IDs to permission names for backend compatibility
      const selectedPermissionNames: string[] = [];

      // Look up each selected permission ID in availablePermissions and get the name
      Array.from(this.selectedPermissions).forEach(permissionId => {
        const permission = this.availablePermissions.find(p => p.id === permissionId);
        if (permission && permission.name) {
          selectedPermissionNames.push(permission.name);
        }
      });

      const roleToSave: any = {
        name: this.formData.name.trim(),
        description: this.formData.description?.trim() || '',
        permissions: selectedPermissionNames // Send as permission names array to match backend DTO
      };

      // Include ID if editing
      if (this.editMode && this.roleData?.id) {
        roleToSave.id = this.roleData.id;
      }

      this.sidePanelRef.close(roleToSave);
    }
  }
}
