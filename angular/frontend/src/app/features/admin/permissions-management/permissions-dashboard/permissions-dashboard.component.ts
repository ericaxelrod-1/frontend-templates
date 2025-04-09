import { Component, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PermissionManagementService } from '../../../../core/services/permission-management.service';

@Component({
  selector: 'app-permissions-dashboard',
  templateUrl: './permissions-dashboard.component.html',
  styleUrls: ['./permissions-dashboard.component.scss']
})
export class PermissionsDashboardComponent implements OnInit {
  loading = false;
  
  constructor(
    private permissionService: PermissionManagementService,
    private snackBar: MatSnackBar
  ) { }

  ngOnInit(): void {
  }
  
  syncAllPermissions(): void {
    this.loading = true;
    this.permissionService.syncPermissions('all').subscribe(
      response => {
        this.snackBar.open('All permissions synchronized successfully', 'Close', { duration: 3000 });
        this.loading = false;
      },
      error => {
        console.error('Error syncing permissions:', error);
        this.snackBar.open('Failed to synchronize permissions', 'Close', { duration: 3000 });
        this.loading = false;
      }
    );
  }
  
  syncComponents(): void {
    this.loading = true;
    this.permissionService.syncPermissions('components').subscribe(
      response => {
        this.snackBar.open('Components synchronized successfully', 'Close', { duration: 3000 });
        this.loading = false;
      },
      error => {
        console.error('Error syncing components:', error);
        this.snackBar.open('Failed to synchronize components', 'Close', { duration: 3000 });
        this.loading = false;
      }
    );
  }
  
  syncRoutes(): void {
    this.loading = true;
    this.permissionService.syncPermissions('routes').subscribe(
      response => {
        this.snackBar.open('Routes synchronized successfully', 'Close', { duration: 3000 });
        this.loading = false;
      },
      error => {
        console.error('Error syncing routes:', error);
        this.snackBar.open('Failed to synchronize routes', 'Close', { duration: 3000 });
        this.loading = false;
      }
    );
  }
  
  syncEndpoints(): void {
    this.loading = true;
    this.permissionService.syncPermissions('endpoints').subscribe(
      response => {
        this.snackBar.open('Endpoints synchronized successfully', 'Close', { duration: 3000 });
        this.loading = false;
      },
      error => {
        console.error('Error syncing endpoints:', error);
        this.snackBar.open('Failed to synchronize endpoints', 'Close', { duration: 3000 });
        this.loading = false;
      }
    );
  }
} 