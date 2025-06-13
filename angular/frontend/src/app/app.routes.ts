import { Routes } from '@angular/router';
import { AuthGuard, PasswordChangeGuard } from './core/guards';
import { PermissionGuard } from './core/guards/permission.guard';

// Layout components
import { CustomLayoutComponent } from './layouts/custom-layout/custom-layout.component';
import { AdminLayoutComponent } from './layouts/admin/admin.component';

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
      }
    ]
  },
  {
    path: 'admin',
    component: AdminLayoutComponent,
    canActivate: [AuthGuard, PasswordChangeGuard, PermissionGuard],
    data: { 
      permissions: 'system:admin'
    },
    loadChildren: () => import('./modules/admin/admin.module').then(m => m.AdminModule)
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
