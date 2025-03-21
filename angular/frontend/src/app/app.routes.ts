import { Routes } from '@angular/router';
import { MainLayoutComponent } from './layouts/main-layout/main-layout.component';
import { ErrorComponent } from './shared/error/error.component';
import { AuthGuard } from './core/guards';

export const routes: Routes = [
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.module').then(m => m.AuthModule)
  },
  {
    path: '',
    component: MainLayoutComponent,
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.component').then(c => c.DashboardComponent),
        canActivate: [AuthGuard]
      },
      {
        path: 'users',
        loadComponent: () => import('./features/users/users.component').then(c => c.UsersComponent),
        canActivate: [AuthGuard]
      },
      {
        path: 'groups',
        loadComponent: () => import('./features/groups/groups.component').then(c => c.GroupsComponent),
        canActivate: [AuthGuard]
      },
      {
        path: 'tasks',
        loadComponent: () => import('./features/tasks/tasks.component').then(c => c.TasksComponent),
        canActivate: [AuthGuard]
      }
    ]
  },
  {
    path: '**',
    component: ErrorComponent,
    data: {
      errorTitle: 'Page Not Found',
      errorMessage: 'The page you are looking for does not exist.',
      showHomeButton: true,
      showBackButton: true
    }
  }
];
