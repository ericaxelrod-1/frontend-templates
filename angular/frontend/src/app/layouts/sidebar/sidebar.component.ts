import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { PermissionService } from '../../core/services/permission.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatListModule,
    MatIconModule,
    MatSidenavModule,
    RouterModule
  ],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent implements OnInit {
  @Input() opened = false;
  
  // Common navigation items for all users
  commonNavItems = [
    { label: 'Dashboard', icon: 'dashboard', route: '/app/dashboard' },
    { 
      label: 'Users', 
      icon: 'people', 
      route: '/app/users', 
      permission: 'users:list'
    },
  ];

  // Navigation items for users with group and role management
  adminNavItems = [
    { 
      label: 'Groups', 
      icon: 'group_work', 
      route: '/app/groups', 
      permission: 'groups:list'
    },
    { 
      label: 'Roles', 
      icon: 'admin_panel_settings', 
      route: '/app/roles', 
      permission: 'roles:list'
    }
  ];

  // Admin section items (only for users with admin access)
  adminItems = [
    { 
      label: 'Login Monitoring', 
      icon: 'security', 
      route: '/admin/login-monitoring', 
      permission: 'login-monitoring:view'
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
    // No initialization needed
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
    return this.permissionService.hasPermissionSync('users:manage') ||
           this.permissionService.hasPermissionSync('roles:manage') ||
           this.permissionService.hasPermissionSync('groups:manage') ||
           this.permissionService.hasPermissionSync('system:admin');
  }

  /**
   * Check if user has access to the admin section
   */
  hasAdminAccess(): boolean {
    return this.permissionService.hasPermissionSync('admin:access');
  }

  /**
   * Check if user has access to user management
   */
  hasUserManagementAccess(): boolean {
    return this.permissionService.hasPermissionSync('users:list') ||
           this.permissionService.hasPermissionSync('users:manage') ||
           this.permissionService.hasPermissionSync('users:admin');
  }

  /**
   * Check if the user has a specific permission
   */
  hasPermission(permission: string): boolean {
    return this.permissionService.hasPermissionSync(permission);
  }
}
