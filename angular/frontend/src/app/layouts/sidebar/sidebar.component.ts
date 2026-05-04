import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil, Observable } from 'rxjs';
import { Store, Select } from '@ngxs/store';
import { AuthService } from '../../core/services/auth.service';
import { PermissionService } from '../../core/services/permission.service';
import { SystemHealthState } from '../../store/system-health/system-health.state';
import { SystemHealthActions } from '../../store/system-health/system-health.actions';
import { User } from '../../models/user.model';

export interface NavItem {
  label: string;
  route: string;
  icon: string;
  permission?: string;
}

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
  
  @Select(SystemHealthState.getStatus) healthStatus$!: Observable<string>;
  
  currentUser: User | null = null;
  private destroy$ = new Subject<void>();
  
  commonNavItems: NavItem[] = [
    { label: 'Dashboard', route: '/', icon: 'dashboard' },
    { label: 'Privacy Preferences', route: '/privacy-preferences', icon: 'privacy_tip' }
  ];

  adminNavItems: NavItem[] = [
    { label: 'User Management', route: '/admin/users', icon: 'people', permission: 'users:read' },
    { label: 'Role Management', route: '/admin/roles', icon: 'security', permission: 'roles:read' },
    { label: 'Groups', route: '/app/groups', icon: 'group_work', permission: 'groups:view' }
  ];

  adminItems: NavItem[] = [
    { label: 'Login Attempts', route: '/app/admin/login-attempts', icon: 'login', permission: 'login-monitoring:read' },
    { label: 'Pattern Detection', route: '/app/admin/pattern-detection', icon: 'pattern', permission: 'login-monitoring:read' },
    { label: 'Security Alerts', route: '/app/admin/security-alerts', icon: 'warning', permission: 'login-monitoring:read' },
    { label: 'IP Reputation', route: '/app/admin/ip-reputation', icon: 'fingerprint', permission: 'login-monitoring:read' },
    { label: 'Login Monitoring (Legacy)', route: '/app/admin/login-monitoring', icon: 'security', permission: 'login-monitoring:read' },
    { label: 'RLS Rules', route: '/app/admin/rls-rules', icon: 'rule', permission: 'rls:admin' },
    { label: 'Join Paths', route: '/app/admin/join-paths', icon: 'account_tree', permission: 'rls:admin' },
    { label: 'Scope Templates', route: '/app/admin/scope-templates', icon: 'layers', permission: 'rls:admin' },
    { label: 'Permission Inspector', route: '/app/admin/permission-inspector', icon: 'search', permission: 'rls:admin' },
    { label: 'Privacy Dashboard', route: '/admin/privacy', icon: 'policy', permission: 'privacy:admin' },
    { label: 'System Health', route: '/admin/health', icon: 'health_and_safety', permission: 'system:health' }
  ];

  get isAdminOrManager(): boolean {
    return this.permissionService.hasPermissionSync('users:read') || 
           this.permissionService.hasPermissionSync('roles:read') ||
           this.permissionService.hasPermissionSync('groups:view') ||
           this.permissionService.hasPermissionSync('system:admin');
  }
  
  constructor(
    private authService: AuthService,
    private permissionService: PermissionService,
    private store: Store
  ) {}
  
  ngOnInit() {
    // Subscribe to current user changes
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser = user;
      });

    // Start polling health status if user has admin access
    if (this.hasAdminAccess()) {
      this.store.dispatch(new SystemHealthActions.FetchHealth());
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  hasPermission(permission: string | undefined): boolean {
    if (!permission) return true;
    return this.permissionService.hasPermissionSync(permission);
  }

  hasAdminAccess(): boolean {
    return this.permissionService.hasPermissionSync('admin:access') || 
           this.permissionService.hasPermissionSync('system:health');
  }

  /**
   * Returns a CSS class or color for navigation icons based on system health
   */
  getIconColor(item: any, healthStatus: string | null): string {
    if (item.label === 'System Health') {
      switch (healthStatus?.toLowerCase()) {
        case 'warning': return 'status-warning';
        case 'critical': return 'status-critical';
        case 'panic': return 'status-panic';
        case 'healthy': return 'status-healthy';
        default: return '';
      }
    }
    return '';
  }
}
