import { Component, OnInit, OnDestroy, Input } from '@angular/core';
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
  @Input() isCollapsed = false; // Controls whether sidebar shows only icons or full text
  @Input() isAdminContext = false; // Indicates if we're in admin context
  
  currentUser: User | null = null;
  private destroy$ = new Subject<void>();
  
  // Common navigation items for all users
  commonNavItems = [
    { label: 'Dashboard', icon: 'dashboard', route: '/app/dashboard' },
    { 
      label: 'Users', 
      icon: 'people', 
      route: '/app/users', 
      permission: 'users:view'
    },
  ];

  // Navigation items for users with group and role management
  adminNavItems = [
    { 
      label: 'Groups', 
      icon: 'group_work', 
      route: '/app/groups', 
      permission: 'groups:view'
    },
    { 
      label: 'Roles', 
      icon: 'admin_panel_settings', 
      route: '/app/roles', 
      permission: 'roles:view'
    }
  ];

  // Admin section items (only for users with admin access)
  adminItems = [
    { 
      label: 'Administration', 
      icon: 'security', 
      route: '/app/admin/login-monitoring', 
      permission: 'system:admin'
    }
  ];
  
  constructor(
    private authService: AuthService,
    private permissionService: PermissionService
  ) {
    // Debug: Log navigation items and permissions
    console.log('Sidebar: Common nav items:', this.commonNavItems);
    console.log('Sidebar: Admin nav items:', this.adminNavItems);
  }
  
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
    return this.permissionService.hasPermissionSync('users:view') ||
           this.permissionService.hasPermissionSync('roles:view') ||
           this.permissionService.hasPermissionSync('groups:view') ||
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
    return this.permissionService.hasPermissionSync('users:view') ||
           this.permissionService.hasPermissionSync('users:update') ||
           this.permissionService.hasPermissionSync('system:admin');
  }

  /**
   * Check if the user has a specific permission
   */
  hasPermission(permission: string): boolean {
    const hasPermission = this.permissionService.hasPermissionSync(permission);
    console.log(`Sidebar: Checking permission '${permission}':`, hasPermission);
    return hasPermission;
  }
}
