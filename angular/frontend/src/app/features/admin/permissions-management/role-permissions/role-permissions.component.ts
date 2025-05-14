import { Component, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';
import { FormControl } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PermissionService, Role, Permission } from '../../../../core/services/permission.service';
import { EditRolePermissionsDialogComponent } from './edit-role-permissions-dialog/edit-role-permissions-dialog.component';

@Component({
  selector: 'app-role-permissions',
  templateUrl: './role-permissions.component.html',
  styleUrls: ['./role-permissions.component.scss']
})
export class RolePermissionsComponent implements OnInit, AfterViewInit {
  roles: Role[] = [];
  selectedRole: Role | null = null;
  allPermissions: Permission[] = [];
  rolePermissions: Permission[] = [];
  
  dataSource = new MatTableDataSource<Role>([]);
  displayedColumns: string[] = ['name', 'description', 'permissionCount', 'actions'];
  filterControl = new FormControl('');
  
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;
  
  loading = false;
  
  constructor(
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) { }

  ngOnInit(): void {
    this.loadRoles();
    this.loadAllPermissions();
    
    this.filterControl.valueChanges.subscribe(value => {
      this.dataSource.filter = value ? value.trim().toLowerCase() : '';
    });
  }
  
  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }
  
  loadRoles(): void {
    this.loading = true;
    this.permissionService.getAllRoles().subscribe(
      roles => {
        this.roles = roles;
        this.dataSource.data = roles;
        this.loading = false;
      },
      error => {
        console.error('Error loading roles:', error);
        this.snackBar.open('Failed to load roles', 'Close', { duration: 3000 });
        this.loading = false;
      }
    );
  }
  
  loadAllPermissions(): void {
    this.permissionService.getAllPermissions().subscribe(
      permissions => {
        this.allPermissions = permissions;
      },
      error => {
        console.error('Error loading permissions:', error);
        this.snackBar.open('Failed to load permissions', 'Close', { duration: 3000 });
      }
    );
  }
  
  selectRole(role: Role): void {
    this.selectedRole = role;
    this.loadRolePermissions(role.id);
  }
  
  loadRolePermissions(roleId: string): void {
    this.loading = true;
    this.permissionService.getRolePermissions(roleId).subscribe(
      permissions => {
        this.rolePermissions = permissions;
        this.loading = false;
      },
      error => {
        console.error('Error loading role permissions:', error);
        this.snackBar.open('Failed to load role permissions', 'Close', { duration: 3000 });
        this.loading = false;
      }
    );
  }
  
  openEditDialog(role: Role): void {
    this.selectRole(role);
    
    const dialogRef = this.dialog.open(EditRolePermissionsDialogComponent, {
      width: '800px',
      data: {
        role: this.selectedRole,
        allPermissions: this.allPermissions,
        rolePermissions: this.rolePermissions
      }
    });
    
    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.updateRolePermissions(role.id, result.grantedPermissions, result.revokedPermissions);
      }
    });
  }
  
  updateRolePermissions(roleId: string, grantedPermissions: string[], revokedPermissions: string[]): void {
    this.loading = true;
    
    // Get current permissions for the role
    this.permissionService.getRolePermissions(roleId).subscribe(
      currentPermissions => {
        // Create new permissions array by:
        // 1. Starting with current permissions
        // 2. Adding newly granted permissions
        // 3. Removing revoked permissions
        const updatedPermissions = currentPermissions
          .map(p => p.id) // Get current permission IDs
          .filter(id => !revokedPermissions.includes(id)) // Remove revoked permissions
          .concat(grantedPermissions); // Add new permissions
        
        // Update all permissions in a single call
        this.permissionService.updateRolePermissions(roleId, updatedPermissions)
          .subscribe(
            () => {
              this.snackBar.open('Role permissions updated successfully', 'Close', { duration: 3000 });
              this.loadRoles();
              if (this.selectedRole) {
                this.loadRolePermissions(this.selectedRole.id);
              }
              this.loading = false;
            },
            error => {
              console.error('Error updating role permissions:', error);
              this.snackBar.open('Failed to update role permissions', 'Close', { duration: 3000 });
              this.loading = false;
            }
          );
      },
      error => {
        console.error('Error loading current role permissions:', error);
        this.snackBar.open('Failed to update role permissions', 'Close', { duration: 3000 });
        this.loading = false;
      }
    );
  }
  
  refreshData(): void {
    this.loadRoles();
    this.loadAllPermissions();
    if (this.selectedRole) {
      this.loadRolePermissions(this.selectedRole.id);
    }
  }
} 