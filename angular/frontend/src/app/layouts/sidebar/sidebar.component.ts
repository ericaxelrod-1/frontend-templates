import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil, Observable, map } from 'rxjs';
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
  @Input() isCollapsed = false;
  @Input() isAdminContext = false;
  
  @Select(SystemHealthState.getStatus) healthStatus$!: Observable<string>;
  
  currentUser: User | null = null;
  private destroy$ = new Subject<void>();
  
  private commonNavItems: NavItem[] = [
    { label: 'Dashboard', route: '/', icon: 'dashboard' },
    { label: 'Privacy Preferences', route: '/app/privacy/settings', icon: 'privacy_tip' }
  ];

  private adminNavItems: NavItem[] = [
    { label: 'User Management', route: '/admin/users', icon: 'people', permission: 'users:read' },
    { label: 'Role Management', route: '/admin/roles', icon: 'security', permission: 'roles:read' },
    { label: 'Groups', route: '/app/groups', icon: 'group_work', permission: 'groups:view' }
  ];

  private adminItems: NavItem[] = [
    { label: 'Login Attempts', route: '/app/admin/login-attempts', icon: 'login', permission: 'login-monitoring:read' },
    { label: 'Pattern Detection', route: '/app/admin/pattern-detection', icon: 'pattern', permission: 'login-monitoring:read' },
    { label: 'Security Alerts', route: '/app/admin/security-alerts', icon: 'warning', permission: 'login-monitoring:read' },
    { label: 'IP Reputation', route: '/app/admin/ip-reputation', icon: 'fingerprint', permission: 'login-monitoring:read' },
    { label: 'Login Monitoring (Legacy)', route: '/app/admin/login-monitoring', icon: 'security', permission: 'login-monitoring:read' },
    { label: 'RLS Rules', route: '/app/admin/rls-rules', icon: 'rule', permission: 'rls:admin' },
    { label: 'Join Paths', route: '/app/admin/join-paths', icon: 'account_tree', permission: 'rls:admin' },
    { label: 'Scope Templates', route: '/app/admin/scope-templates', icon: 'layers', permission: 'rls:admin' },
    { label: 'Permission Inspector', route: '/app/admin/permission-inspector', icon: 'search', permission: 'rls:admin' },
    { label: 'Privacy Dashboard', route: '/app/admin/privacy', icon: 'policy', permission: 'privacy:read' },
    { label: 'System Health', route: '/admin/health', icon: 'health_and_safety', permission: 'system:health' }
  ];

  filteredCommonNavItems$!: Observable<NavItem[]>;
  filteredAdminNavItems$!: Observable<NavItem[]>;
  filteredAdminItems$!: Observable<NavItem[]>;
  isAdminOrManager$!: Observable<boolean>;
  hasAdminAccess$!: Observable<boolean>;
  
  constructor(
    private authService: AuthService,
    private permissionService: PermissionService,
    private store: Store
  ) {}
  
  ngOnInit() {
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser = user;
      });

    // Reactive visibility and filtering
    const permissions$ = this.permissionService.userPermissions$;

    this.isAdminOrManager$ = permissions$.pipe(
      map(perms => perms.includes('users:read') || 
                   perms.includes('roles:read') || 
                   perms.includes('groups:view') || 
                   perms.includes('system:admin'))
    );

    this.hasAdminAccess$ = permissions$.pipe(
      map(perms => perms.includes('system:admin') || perms.includes('system:health'))
    );

    this.filteredCommonNavItems$ = permissions$.pipe(
      map(perms => this.commonNavItems.filter(item => !item.permission || perms.includes(item.permission)))
    );

    this.filteredAdminNavItems$ = permissions$.pipe(
      map(perms => this.adminNavItems.filter(item => !item.permission || perms.includes(item.permission)))
    );

    this.filteredAdminItems$ = permissions$.pipe(
      map(perms => this.adminItems.filter(item => !item.permission || perms.includes(item.permission)))
    );

    // Start polling health status if user has admin access
    this.hasAdminAccess$.pipe(takeUntil(this.destroy$)).subscribe(hasAccess => {
      if (hasAccess) {
        this.store.dispatch(new SystemHealthActions.FetchHealth());
      }
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
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
