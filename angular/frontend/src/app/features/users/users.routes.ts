import { Routes } from '@angular/router';
import { PermissionGuard } from '../../core/guards/permission.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./users.component').then(c => c.UsersComponent),
  },
  {
    path: 'create',
    loadComponent: () => import('./create-user.component').then(c => c.CreateUserComponent),
    canActivate: [PermissionGuard],
    data: { 
      permissions: 'users:create'
    }
  }
]; 