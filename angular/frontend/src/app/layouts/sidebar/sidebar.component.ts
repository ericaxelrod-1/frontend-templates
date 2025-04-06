import { Component, Input } from '@angular/core';
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
export class SidebarComponent {
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
  
  // Determines if the user has superadmin role
  get isSuperAdmin(): boolean {
    return this.authService.hasRole('SUPERADMIN');
  }

  // Determines if the user has admin or project manager role
  get isAdminOrProjectManager(): boolean {
    return this.authService.hasRole('ADMIN') || this.authService.hasRole('PROJECT_MANAGER');
  }
}
