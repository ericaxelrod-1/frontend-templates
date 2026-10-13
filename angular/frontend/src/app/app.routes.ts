import { Routes } from '@angular/router';
import { AuthGuard, PasswordChangeGuard } from './core/guards';
import { PermissionGuard } from './core/guards/permission.guard';

// Layout components
import { CustomLayoutComponent } from './layouts/custom-layout/custom-layout.component';

import { PublicLayoutComponent } from './layouts/public-layout/public-layout.component';

/**
 * Main application routes
 * 
 * Updated to use CustomLayoutComponent for truly non-responsive sidebar behavior.
 * The custom layout eliminates Angular Material's built-in responsive system
 * and provides a fixed 280px sidebar at all screen sizes.
 * 
 * Permission-based routes should use the following format for data:
 * { permissions: 'resource:action' } OR
 * { permissions: ['resource1:action1', 'resource2:action2'] } OR 
 * { permissions: { all: ['resource1:action1', 'resource2:action2'] } }
 */
export const routes: Routes = [
  {
    path: 'app',
    loadComponent: () => import('./layouts/custom-layout/custom-layout.component').then(c => c.CustomLayoutComponent),
    canActivate: [AuthGuard],
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        loadChildren: () => import('./features/dashboard/dashboard.routes').then(m => m.routes),
        canActivate: [AuthGuard]
      },
      {
        path: 'profile',
        loadChildren: () => import('./features/profile/profile.routes').then(m => m.routes),
        canActivate: [AuthGuard]
      },
      {
        path: 'privacy',
        children: [
          {
            path: '',
            loadComponent: () => import('./features/privacy/privacy-dashboard.component').then(c => c.PrivacyDashboardComponent),
            canActivate: [AuthGuard]
          },
          {
            path: 'settings',
            loadComponent: () => import('./features/privacy/privacy-settings.component').then(c => c.PrivacySettingsComponent),
            canActivate: [AuthGuard]
          }
        ]
      },
      {
        path: 'profile/change-password',
        loadComponent: () => import('./features/profile/password-change/password-change.component').then(c => c.PasswordChangeComponent),
        canActivate: [AuthGuard]
      },
      {
        path: 'users',
        loadChildren: () => import('./features/users/users.routes').then(m => m.routes),
        canActivate: [PermissionGuard],
        data: {
          permissions: 'users:view'
        }
      },
      {
        path: 'groups',
        loadComponent: () => import('./features/groups/groups.component').then(c => c.GroupsComponent),
        canActivate: [PermissionGuard],
        data: {
          permissions: 'groups:view'
        }
      },
      {
        path: 'roles',
        loadComponent: () => import('./features/roles/roles.component').then(c => c.RolesComponent),
        canActivate: [PermissionGuard],
        data: {
          permissions: 'roles:view'
        }
      },
      {
        path: 'admin',
        canActivate: [PasswordChangeGuard, PermissionGuard],
        // The parent is a coarse gate: it answers "may this user enter the
        // admin section at all", not "may this user see every page in it".
        // Naming a single permission here (it was `system:admin`) denied the
        // whole section to anyone holding only a page's own permission — the
        // Administrator role holds `system:health` and `privacy:read` but not
        // `system:admin`, so it could see the links and never reach them.
        // Holding ANY of the permissions the section grants is sufficient;
        // holding none of them is still refused. Each child below is guarded
        // individually as well.
        data: {
          permissions: [
            'system:admin',
            'system:health',
            'login-monitoring:read',
            'rls:admin',
            'privacy:read',
          ]
        },
        children: [
          {
            path: '',
            redirectTo: 'login-attempts',
            pathMatch: 'full'
          },
          {
            path: 'login-monitoring',
            loadComponent: () => import('./modules/admin/login-monitoring/login-monitoring.component').then(c => c.LoginMonitoringComponent),
            canActivate: [PermissionGuard],
            data: {
              permissions: 'login-monitoring:read'
            }
          },
          {
            path: 'login-attempts',
            loadComponent: () => import('./modules/admin/login-attempts/login-attempts.component').then(c => c.LoginAttemptsComponent),
            canActivate: [PermissionGuard],
            data: {
              permissions: 'login-monitoring:read'
            }
          },
          {
            path: 'pattern-detection',
            loadComponent: () => import('./modules/admin/pattern-detection/pattern-detection.component').then(c => c.PatternDetectionComponent),
            canActivate: [PermissionGuard],
            data: {
              permissions: 'login-monitoring:read'
            }
          },
          {
            path: 'security-alerts',
            loadComponent: () => import('./modules/admin/security-alerts/security-alerts.component').then(c => c.SecurityAlertsComponent),
            canActivate: [PermissionGuard],
            data: {
              permissions: 'login-monitoring:read'
            }
          },
          {
            path: 'ip-reputation',
            loadComponent: () => import('./modules/admin/ip-reputation/ip-reputation.component').then(c => c.IpReputationComponent),
            canActivate: [PermissionGuard],
            data: {
              permissions: 'login-monitoring:read'
            }
          },
          {
            path: 'system-health',
            loadComponent: () => import('./features/admin/system-health/system-health.component').then(c => c.SystemHealthComponent),
            canActivate: [PermissionGuard],
            // `system:health` is the granular permission seeded for this page
            // ("View system health and resource stats") and granted to the
            // Administrator role. Requiring `system:admin` here contradicted
            // the sidebar, which offers the link on `system:health`.
            data: {
              permissions: 'system:health'
            }
          },
          {
            path: 'rls-rules',
            loadComponent: () => import('./features/admin/rls-management/rls-admin.component').then(c => c.RlsAdminComponent),
            canActivate: [PermissionGuard],
            data: {
              permissions: 'rls:admin'
            }
          },
          {
            path: 'join-paths',
            loadComponent: () => import('./features/admin/rls-management/join-paths-admin.component').then(c => c.JoinPathsAdminComponent),
            canActivate: [PermissionGuard],
            data: {
              permissions: 'rls:admin'
            }
          },
          {
            path: 'scope-templates',
            loadComponent: () => import('./features/admin/rls-management/scope-templates-admin.component').then(c => c.ScopeTemplatesAdminComponent),
            canActivate: [PermissionGuard],
            data: {
              permissions: 'rls:admin'
            }
          },
          {
            path: 'permission-inspector',
            loadComponent: () => import('./features/admin/rls-management/permission-inspector.component').then(c => c.PermissionInspectorComponent),
            canActivate: [PermissionGuard],
            data: {
              permissions: 'rls:admin'
            }
          },
          {
            path: 'privacy-requests',
            loadComponent: () => import('./features/admin/privacy-management/privacy-admin.component').then(c => c.PrivacyAdminComponent),
            canActivate: [PermissionGuard],
            data: {
              permissions: 'privacy:read'
            }
          }
        ]
      }
    ]
  },
  {
    path: '',
    loadComponent: () => import('./layouts/public-layout/public-layout.component').then(c => c.PublicLayoutComponent),
    children: [
      {
        path: '',
        loadComponent: () => import('./pages/landing/landing.component').then(c => c.LandingComponent),
        pathMatch: 'full'
      },
      {
        path: '',
        loadChildren: () => import('./features/auth/auth.routes').then(m => m.routes)
      },
      {
        path: 'features/rbac',
        loadComponent: () => import('./pages/features/rbac-feature/rbac-feature.component').then(c => c.RbacFeatureComponent)
      },
      {
        path: 'features/auth',
        loadComponent: () => import('./pages/features/auth-feature/auth-feature.component').then(c => c.AuthFeatureComponent)
      },
      {
        path: 'features/logging',
        loadComponent: () => import('./pages/features/logging-feature/logging-feature.component').then(c => c.LoggingFeatureComponent)
      },
      {
        path: 'features/security',
        loadComponent: () => import('./pages/features/security-feature/security-feature.component').then(c => c.SecurityFeatureComponent)
      },
      {
        path: 'features/admin',
        loadComponent: () => import('./pages/features/admin-feature/admin-feature.component').then(c => c.AdminFeatureComponent)
      },
      {
        path: 'terms-of-service',
        loadComponent: () => import('./features/legal/terms-of-service/terms-of-service.component').then(c => c.TermsOfServiceComponent)
      },
      {
        path: 'privacy-policy',
        loadComponent: () => import('./features/legal/privacy-policy/privacy-policy.component').then(c => c.PrivacyPolicyComponent)
      },
      {
        path: 'privacy/request',
        loadComponent: () => import('./features/privacy/public-request.component').then(c => c.PublicPrivacyComponent)
      },
      {
        path: 'blocked',
        loadComponent: () => import('./features/blocked/blocked.component').then(c => c.BlockedComponent)
      }
    ]
  },
  {
    // Where `PermissionInterceptor` sends a 403. This route did not exist, so
    // every forbidden response matched the `**` catch-all and dropped the user
    // on the public landing page instead of telling them they were refused.
    // Intentionally outside the `app` shell and unguarded: a 403 is only issued
    // to an authenticated caller, and the page must stay reachable while a
    // session is being torn down (adding AuthGuard here risks a redirect loop
    // against the interceptor that navigates to it).
    path: 'access-denied',
    loadComponent: () => import('./shared/components/access-denied/access-denied.component').then(c => c.AccessDeniedComponent)
  },
  {
    path: '**',
    redirectTo: '/'
  }
];
