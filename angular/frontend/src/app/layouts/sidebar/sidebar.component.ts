import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { PermissionService } from '../../core/services/permission.service';
import { User } from '../../models/user.model';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatDividerModule,
    RouterModule
  ],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent implements OnInit, OnDestroy {
  currentUser: User | null = null;
  private destroy$ = new Subject<void>();
  
  // Common navigation items for all users
  commonNavItems = [
    { label: 'Dashboard', icon: 'dashboard', route: '/app/dashboard' },
    { 
      label: 'Users', 
      icon: 'people', 
      route: '/app/users', 
      permission: 'users:read'
    },
  ];

  // Navigation items for users with group and role management
  adminNavItems = [
    { 
      label: 'Groups', 
      icon: 'group_work', 
      route: '/app/groups', 
      permission: 'groups:read'
    },
    { 
      label: 'Roles', 
      icon: 'admin_panel_settings', 
      route: '/app/roles', 
      permission: 'roles:read'
    }
  ];

  // Admin section items (only for users with admin access)
  adminItems = [
    { 
      label: 'Activity Monitor', 
      icon: 'security', 
      route: '/admin/login-monitoring', 
      permission: 'system:admin'
    },
    { 
      label: 'Permissions', 
      icon: 'shield', 
      route: '/admin/permissions', 
      permission: 'permissions:admin'
    }
  ];
  
  constructor(
    private authService: AuthService,
    private permissionService: PermissionService
  ) {}
  
  ngOnInit() {
    // Subscribe to current user changes
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser = user;
      });
  }
  
  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
  
  /**
   * Determines if the user has system admin access
   */
  get isSuperAdmin(): boolean {
    return this.permissionService.hasPermissionSync('system:admin');
  }

  /**
   * Determines if the user has access to manage users, roles, or groups
   */
  get isAdminOrManager(): boolean {
    return this.permissionService.hasPermissionSync('users:read') ||
           this.permissionService.hasPermissionSync('roles:read') ||
           this.permissionService.hasPermissionSync('groups:read') ||
           this.permissionService.hasPermissionSync('system:admin');
  }

  /**
   * Check if user has access to the admin section
   */
  hasAdminAccess(): boolean {
    return this.permissionService.hasPermissionSync('system:admin');
  }

  /**
   * Check if user has access to user management
   */
  hasUserManagementAccess(): boolean {
    return this.permissionService.hasPermissionSync('users:read') ||
           this.permissionService.hasPermissionSync('users:update') ||
           this.permissionService.hasPermissionSync('system:admin');
  }

  /**
   * Check if the user has a specific permission
   */
  hasPermission(permission: string): boolean {
    return this.permissionService.hasPermissionSync(permission);
  }
}
