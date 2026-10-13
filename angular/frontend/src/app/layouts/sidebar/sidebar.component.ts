import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil, Observable, map } from 'rxjs';
import { Store } from '@ngxs/store';
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

  /**
   * Bound through `store.select` rather than `@Select`: `@Select` installs a
   * prototype getter, which the `foo$!: Observable<T>` field declaration
   * shadows with `undefined` under `useDefineForClassFields` (implied by
   * `target: ES2022`). AsyncPipe swallows the null, so the status-driven icon
   * colour below was silently never applied.
   */
  readonly healthStatus$: Observable<string>;

  currentUser: User | null = null;
  private destroy$ = new Subject<void>();
  
  private commonNavItems: NavItem[] = [
    // Every route below must exist under the authenticated `/app` shell. `/`
    // resolves to the public landing page via the catch-all, so the old
    // Dashboard entry logged the user out of the app shell.
    { label: 'Dashboard', route: '/app/dashboard', icon: 'dashboard' },
    { label: 'Privacy Preferences', route: '/app/privacy/settings', icon: 'privacy_tip' }
  ];

  // `permission` must name the same permission the target route's guard names,
  // otherwise the link is shown to someone who cannot open it, or hidden from
  // someone who can. The route guards use the `:view` action for users and
  // roles; these were `:read`.
  private adminNavItems: NavItem[] = [
    { label: 'User Management', route: '/app/users', icon: 'people', permission: 'users:view' },
    { label: 'Role Management', route: '/app/roles', icon: 'security', permission: 'roles:view' },
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
    { label: 'Privacy Requests', route: '/app/admin/privacy-requests', icon: 'policy', permission: 'privacy:read' },
    // The route is /app/admin/system-health; `/admin/health` matched nothing
    // and fell through to the catch-all, which redirects to the public landing
    // page — signing the user out of the app shell from an admin-only link.
    { label: 'System Health', route: '/app/admin/system-health', icon: 'health_and_safety', permission: 'system:health' }
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
  ) {
    this.healthStatus$ = this.store.select(SystemHealthState.getStatus);
  }
  
  ngOnInit() {
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser = user;
      });

    // Reactive visibility and filtering
    const permissions$ = this.permissionService.userPermissions$;

    this.isAdminOrManager$ = permissions$.pipe(
      map(perms => perms.includes('users:view') ||
                   perms.includes('roles:view') ||
                   perms.includes('groups:view') ||
                   perms.includes('system:health'))
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
  getIconColor(item: NavItem, healthStatus: string | null): string {
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
