import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './core/guards/auth.guard';
import { PermissionGuard } from './core/guards/permission.guard';
import { LoginComponent } from './features/auth/login/login.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { UnauthorizedComponent } from './features/errors/unauthorized/unauthorized.component';
import { NotFoundComponent } from './features/errors/not-found/not-found.component';
import { AccessDeniedComponent } from './shared/components/access-denied/access-denied.component';

const routes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { 
    path: 'dashboard', 
    component: DashboardComponent, 
    canActivate: [AuthGuard]
  },
  { 
    path: 'users', 
    loadChildren: () => import('./features/users/users.module').then(m => m.UsersModule),
    canActivate: [AuthGuard, PermissionGuard],
    data: {
      permissionRule: 'users:view'
    }
  },
  { 
    path: 'admin/users', 
    loadChildren: () => import('./features/admin/users-management/users-management.module')
      .then(m => m.UsersManagementModule),
    canActivate: [AuthGuard, PermissionGuard],
    data: {
      permissionRule: 'users:manage'
    }
  },
  { 
    path: 'admin/roles', 
    loadChildren: () => import('./features/admin/roles-management/roles-management.module')
      .then(m => m.RolesManagementModule),
    canActivate: [AuthGuard, PermissionGuard],
    data: {
      permissionRule: 'roles:manage'
    }
  },
  { 
    path: 'admin/permissions', 
    loadChildren: () => import('./features/admin/permissions-management/permissions-management.module')
      .then(m => m.PermissionsManagementModule),
    canActivate: [AuthGuard, PermissionGuard],
    data: {
      permissionRule: 'permissions:manage'
    }
  },
  { path: 'unauthorized', component: UnauthorizedComponent },
  { path: 'access-denied', component: AccessDeniedComponent },
  { path: '**', component: NotFoundComponent }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { } 