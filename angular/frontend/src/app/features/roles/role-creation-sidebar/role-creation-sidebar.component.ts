import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
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
    <!-- Sidebar Backdrop -->
    <div class="sidebar-backdrop" 
         [class.backdrop-visible]="isOpen" 
         (click)="onCloseSidebar()">
    </div>
    
    <!-- Sidebar -->
    <div class="role-creation-sidebar" [class.sidebar-open]="isOpen">
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
          </form>
        </div>
        
        <!-- Actions Section -->
        <div class="actions-section">
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
        </div>
      </div>
    </div>
  `,
  styles: [`
    .role-creation-sidebar {
      position: fixed;
      top: 0;
      right: 0;
      width: 600px;
      height: 100vh;
      background-color: #ffffff;
      box-shadow: -2px 0 8px rgba(0, 0, 0, 0.15);
      transform: translateX(100%);
      transition: transform 0.3s ease-in-out;
      z-index: 1100;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      
      &.sidebar-open {
        transform: translateX(0);
      }
    }
    
    .sidebar-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 1099;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.3s ease-in-out, visibility 0.3s ease-in-out;
      
      &.backdrop-visible {
        opacity: 1;
        visibility: visible;
      }
    }
    
    .sidebar-content {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    
    .sidebar-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 24px;
      background-color: #1976d2;
      color: white;
      
      .header-content {
        flex: 1;
        
        h2 {
          margin: 0 0 8px 0;
          font-size: 1.5rem;
          font-weight: 500;
        }
        
        p {
          margin: 0;
          opacity: 0.9;
          font-size: 0.9rem;
        }
      }
      
      .close-button {
        color: white;
        margin-left: 16px;
      }
    }
    
    .form-section {
      flex: 1;
      overflow-y: auto;
      
      .role-form {
        display: flex;
        flex-direction: column;
        
        .basic-info-section {
          padding: 24px;
          
          h3 {
            margin: 0 0 16px 0;
            color: #333;
            font-size: 1.1rem;
          }
          
          .full-width {
            width: 100%;
            margin-bottom: 16px;
          }
          
          textarea {
            resize: vertical;
            min-height: 80px;
          }
        }
        
        .permissions-section {
          padding: 24px;
          
          h3 {
            margin: 0 0 16px 0;
            color: #333;
            font-size: 1.1rem;
          }
          
          .select-all {
            margin-bottom: 16px;
            padding: 12px;
            background-color: #f5f5f5;
            border-radius: 4px;
          }
          
          .resource-select-all {
            margin-bottom: 12px;
            padding: 8px;
            background-color: #e3f2fd;
            border-radius: 4px;
          }
          
          .permissions-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
            margin-bottom: 16px;
          }
          
          .permission-item {
            padding: 12px;
            border-radius: 4px;
            background-color: #fafafa;
            border: 1px solid #e0e0e0;
            
            .permission-description {
              margin-top: 4px;
              font-size: 12px;
              color: rgba(0, 0, 0, 0.6);
              line-height: 1.3;
            }
          }
          
          .permissions-accordion {
            margin-top: 16px;
          }
        }
      }
    }
    
    .actions-section {
      padding: 20px 24px;
      border-top: 1px solid #e0e0e0;
      background-color: #f5f5f5;
      flex-shrink: 0;
      
      .form-validation {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
        padding: 8px 12px;
        background-color: rgba(244, 67, 54, 0.1);
        border-radius: 4px;
        color: #d32f2f;
        font-size: 0.9rem;
        
        .warning-icon {
          font-size: 1.2rem;
          width: 1.2rem;
          height: 1.2rem;
        }
      }
      
      .action-buttons {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        align-items: center;
        
        .cancel-button {
          color: #666;
        }
        
        .save-button {
          min-width: 140px;
          height: 40px;
        }
      }
    }
    
    @media (max-width: 768px) {
      .role-creation-sidebar {
        width: 100vw;
      }
    }
  `]
})
export class RoleCreationSidebarComponent implements OnInit, OnChanges {
  @Input() isOpen = false;
  @Input() roleData: Role | null = null; // For edit mode
  
  @Output() closeSidebar = new EventEmitter<void>();
  @Output() roleSaved = new EventEmitter<Partial<Role>>();
  
  editMode = false;
  formData: Partial<Role> = {
    name: '',
    description: '',
    permissions: []
  };
  
  availablePermissions: Permission[] = [];
  permissionGroups: PermissionGroup[] = [];
  selectedPermissions: Set<string | number> = new Set();
  
  constructor(private roleService: RoleService) {}
  
  ngOnInit(): void {
    this.loadPermissions();
    this.resetForm();
  }
  
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['roleData'] || changes['isOpen']) {
      this.editMode = !!this.roleData;
      this.resetForm();
    }
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
    if (typeof id === 'string' && id.includes(':')) {
      return id.split(':')[0];
    }
    return 'other';
  }
  
  /**
   * Format permission name for display
   */
  formatPermissionName(permission: Permission): string {
    // If permission.id is in resource:action format, use that
    if (typeof permission.id === 'string' && permission.id.includes(':')) {
      return permission.id;
    }
    // Otherwise use name
    return permission.name;
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
    this.closeSidebar.emit();
  }
  
  onSave(): void {
    if (this.formData.name && this.formData.name.trim()) {
      // Convert selected permission IDs back to Permission array
      const selectedPermissionObjects = this.availablePermissions
        .filter(p => this.selectedPermissions.has(p.id));
      
      const roleToSave: Partial<Role> = {
        name: this.formData.name.trim(),
        description: this.formData.description?.trim() || '',
        permissions: selectedPermissionObjects
      };
      
      // Include ID if editing
      if (this.editMode && this.roleData?.id) {
        roleToSave.id = this.roleData.id;
      }
      
      this.roleSaved.emit(roleToSave);
    }
  }
} 