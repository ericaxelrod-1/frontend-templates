import { Component, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';
import { FormControl } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PermissionService, Group, Permission } from '../../../../core/services/permission.service';
import { EditGroupPermissionsDialogComponent } from './edit-group-permissions-dialog/edit-group-permissions-dialog.component';

@Component({
  selector: 'app-group-permissions',
  templateUrl: './group-permissions.component.html',
  styleUrls: ['./group-permissions.component.scss']
})
export class GroupPermissionsComponent implements OnInit, AfterViewInit {
  groups: Group[] = [];
  selectedGroup: Group | null = null;
  allPermissions: Permission[] = [];
  groupPermissions: Permission[] = [];
  
  dataSource = new MatTableDataSource<Group>([]);
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
    this.loadGroups();
    this.loadAllPermissions();
    
    this.filterControl.valueChanges.subscribe(value => {
      this.dataSource.filter = value ? value.trim().toLowerCase() : '';
    });
  }
  
  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }
  
  loadGroups(): void {
    this.loading = true;
    this.permissionService.getAllGroups().subscribe(
      groups => {
        this.groups = groups;
        this.dataSource.data = groups;
        this.loading = false;
      },
      error => {
        console.error('Error loading groups:', error);
        this.snackBar.open('Failed to load groups', 'Close', { duration: 3000 });
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
  
  selectGroup(group: Group): void {
    this.selectedGroup = group;
    this.loadGroupPermissions(group.id);
  }
  
  loadGroupPermissions(groupId: string): void {
    this.loading = true;
    this.permissionService.getGroupPermissions(groupId).subscribe(
      permissions => {
        this.groupPermissions = permissions;
        this.loading = false;
      },
      error => {
        console.error('Error loading group permissions:', error);
        this.snackBar.open('Failed to load group permissions', 'Close', { duration: 3000 });
        this.loading = false;
      }
    );
  }
  
  openEditDialog(group: Group): void {
    this.selectGroup(group);
    
    const dialogRef = this.dialog.open(EditGroupPermissionsDialogComponent, {
      width: '800px',
      data: {
        group: this.selectedGroup,
        allPermissions: this.allPermissions,
        groupPermissions: this.groupPermissions
      }
    });
    
    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.updateGroupPermissions(group.id, result.grantedPermissions, result.revokedPermissions);
      }
    });
  }
  
  updateGroupPermissions(groupId: string, grantedPermissions: string[], revokedPermissions: string[]): void {
    this.loading = true;
    
    // Get current permissions for the group
    this.permissionService.getGroupPermissions(groupId).subscribe(
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
        this.permissionService.updateGroupPermissions(groupId, updatedPermissions)
          .subscribe(
            () => {
              this.snackBar.open('Group permissions updated successfully', 'Close', { duration: 3000 });
              this.loadGroups();
              if (this.selectedGroup) {
                this.loadGroupPermissions(this.selectedGroup.id);
              }
              this.loading = false;
            },
            error => {
              console.error('Error updating group permissions:', error);
              this.snackBar.open('Failed to update group permissions', 'Close', { duration: 3000 });
              this.loading = false;
            }
          );
      },
      error => {
        console.error('Error loading current group permissions:', error);
        this.snackBar.open('Failed to update group permissions', 'Close', { duration: 3000 });
        this.loading = false;
      }
    );
  }
  
  refreshData(): void {
    this.loadGroups();
    this.loadAllPermissions();
    if (this.selectedGroup) {
      this.loadGroupPermissions(this.selectedGroup.id);
    }
  }
} 