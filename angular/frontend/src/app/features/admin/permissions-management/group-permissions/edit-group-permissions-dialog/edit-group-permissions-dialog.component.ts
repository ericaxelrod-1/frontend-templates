import { Component, Inject, OnInit } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { FormControl } from '@angular/forms';
import { MatSelectionListChange } from '@angular/material/list';
import { Group, Permission } from '../../../../../core/services/permission-management.service';

interface DialogData {
  group: Group;
  allPermissions: Permission[];
  groupPermissions: Permission[];
}

@Component({
  selector: 'app-edit-group-permissions-dialog',
  templateUrl: './edit-group-permissions-dialog.component.html',
  styleUrls: ['./edit-group-permissions-dialog.component.scss']
})
export class EditGroupPermissionsDialogComponent implements OnInit {
  group!: Group;
  allPermissions: Permission[] = [];
  groupPermissions: Permission[] = [];
  
  // Track selected and deselected permissions for changes
  grantedPermissions: string[] = [];
  revokedPermissions: string[] = [];
  
  // List of current permission IDs for quick lookup
  currentPermissionIds: Set<string> = new Set<string>();
  
  // Filter
  searchControl = new FormControl('');
  filteredPermissions: Permission[] = [];
  
  // Group permissions by resource
  permissionsByResource: Record<string, Permission[]> = {};
  resourceNames: string[] = [];
  
  constructor(
    public dialogRef: MatDialogRef<EditGroupPermissionsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DialogData
  ) {}

  ngOnInit(): void {
    this.group = this.data.group;
    this.allPermissions = this.data.allPermissions;
    this.groupPermissions = this.data.groupPermissions;
    
    // Initialize the set of current permission IDs
    this.groupPermissions.forEach(perm => {
      this.currentPermissionIds.add(perm.id);
    });
    
    // Group permissions by resource
    this.groupPermissionsByResource();
    
    // Setup filter
    this.searchControl.valueChanges.subscribe(value => {
      this.filterPermissions(value || '');
    });
    
    // Initial filter
    this.filterPermissions('');
  }
  
  groupPermissionsByResource(): void {
    this.permissionsByResource = {};
    
    this.allPermissions.forEach(perm => {
      if (!this.permissionsByResource[perm.resourceName]) {
        this.permissionsByResource[perm.resourceName] = [];
      }
      
      this.permissionsByResource[perm.resourceName].push(perm);
    });
    
    this.resourceNames = Object.keys(this.permissionsByResource).sort();
  }
  
  filterPermissions(searchText: string): void {
    if (!searchText) {
      this.filteredPermissions = this.allPermissions;
      return;
    }
    
    searchText = searchText.toLowerCase();
    this.filteredPermissions = this.allPermissions.filter(perm => 
      perm.name.toLowerCase().includes(searchText) || 
      perm.description?.toLowerCase().includes(searchText) ||
      perm.resourceName.toLowerCase().includes(searchText) ||
      perm.actionName.toLowerCase().includes(searchText)
    );
  }
  
  isPermissionSelected(permission: Permission): boolean {
    return this.currentPermissionIds.has(permission.id) || 
           this.grantedPermissions.includes(permission.id);
  }
  
  togglePermission(permissionId: string): void {
    const isCurrentlySelected = this.currentPermissionIds.has(permissionId);
    
    // If permission was originally selected but now deselected
    if (isCurrentlySelected) {
      if (!this.revokedPermissions.includes(permissionId)) {
        this.revokedPermissions.push(permissionId);
      }
      
      // Remove from granted if it was added there
      const grantedIndex = this.grantedPermissions.indexOf(permissionId);
      if (grantedIndex !== -1) {
        this.grantedPermissions.splice(grantedIndex, 1);
      }
    } 
    // If permission was originally not selected but now selected
    else {
      if (!this.grantedPermissions.includes(permissionId)) {
        this.grantedPermissions.push(permissionId);
      }
      
      // Remove from revoked if it was added there
      const revokedIndex = this.revokedPermissions.indexOf(permissionId);
      if (revokedIndex !== -1) {
        this.revokedPermissions.splice(revokedIndex, 1);
      }
    }
  }
  
  onSelectionChange(event: MatSelectionListChange): void {
    const permissionId = event.options[0].value;
    this.togglePermission(permissionId);
  }
  
  getResourcePermissionCount(resource: string): number {
    return this.permissionsByResource[resource].length;
  }
  
  getSelectedPermissionCountForResource(resource: string): number {
    return this.permissionsByResource[resource].filter(perm => 
      this.isPermissionSelected(perm)
    ).length;
  }
  
  selectAllInResource(resource: string): void {
    this.permissionsByResource[resource].forEach(perm => {
      if (!this.isPermissionSelected(perm)) {
        this.togglePermission(perm.id);
      }
    });
  }
  
  deselectAllInResource(resource: string): void {
    this.permissionsByResource[resource].forEach(perm => {
      if (this.isPermissionSelected(perm)) {
        this.togglePermission(perm.id);
      }
    });
  }
  
  selectAll(): void {
    this.allPermissions.forEach(perm => {
      if (!this.isPermissionSelected(perm)) {
        this.togglePermission(perm.id);
      }
    });
  }
  
  deselectAll(): void {
    this.allPermissions.forEach(perm => {
      if (this.isPermissionSelected(perm)) {
        this.togglePermission(perm.id);
      }
    });
  }
  
  onCancelClick(): void {
    this.dialogRef.close();
  }
  
  onSaveClick(): void {
    this.dialogRef.close({
      grantedPermissions: this.grantedPermissions,
      revokedPermissions: this.revokedPermissions
    });
  }
  
  hasChanges(): boolean {
    return this.grantedPermissions.length > 0 || this.revokedPermissions.length > 0;
  }
} 