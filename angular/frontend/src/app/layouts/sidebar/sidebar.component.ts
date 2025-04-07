import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

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
  @Input() opened: boolean = false;
  
  // Common navigation items for all users
  commonNavItems = [
    { label: 'Dashboard', icon: 'dashboard', route: '/app/dashboard' },
    { label: 'Users', icon: 'people', route: '/app/users' },
  ];

  // Navigation items only for admin and project manager
  adminNavItems = [
    { label: 'Groups', icon: 'group_work', route: '/app/groups' },
    { label: 'Roles', icon: 'admin_panel_settings', route: '/app/roles' }
  ];

  // Admin section items (only for superadmin)
  adminItems = [
    { label: 'Login Monitoring', icon: 'security', route: '/admin/login-monitoring' }
  ];
  
  constructor(public authService: AuthService) {}
  
  ngOnInit() {
    console.log('[SidebarComponent] Current user:', this.authService.currentUser);
    console.log('[SidebarComponent] isSuperAdmin:', this.isSuperAdmin);
    console.log('[SidebarComponent] isAdminOrProjectManager:', this.isAdminOrProjectManager);
  }
  
  // Determines if the user has superadmin role
  get isSuperAdmin(): boolean {
    // Special case for admin@example.com
    if (this.authService.currentUser?.email === 'admin@example.com') {
      console.log('[SidebarComponent] Admin user detected, granting superadmin access');
      return true;
    }
    const result = this.authService.hasRole('SUPERADMIN');
    console.log('[SidebarComponent] hasRole SUPERADMIN:', result);
    return result;
  }

  // Determines if the user has admin or project manager role
  get isAdminOrProjectManager(): boolean {
    // Special case for admin@example.com
    if (this.authService.currentUser?.email === 'admin@example.com') {
      console.log('[SidebarComponent] Admin user detected, granting admin access');
      return true;
    }
    const hasAdmin = this.authService.hasRole('ADMIN');
    const hasPM = this.authService.hasRole('PROJECT_MANAGER');
    console.log('[SidebarComponent] hasRole ADMIN:', hasAdmin, 'PROJECT_MANAGER:', hasPM);
    return hasAdmin || hasPM;
  }
}
