import { Routes } from '@angular/router';
import { AuthGuard, PasswordChangeGuard } from './core/guards';
import { PermissionGuard } from './core/guards/permission.guard';

// Layout components
import { CustomLayoutComponent } from './layouts/custom-layout/custom-layout.component';

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
    component: CustomLayoutComponent,
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
        data: { 
          permissions: 'system:admin'
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
          }
        ]
      }
    ]
  },
  {
    path: '',
    loadChildren: () => import('./features/auth/auth.routes').then(m => m.routes)
  },
  {
    path: '**',
    redirectTo: '/login'
  }
];
