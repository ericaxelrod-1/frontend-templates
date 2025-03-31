import { Routes } from '@angular/router';
import { MainLayoutComponent } from './layouts/main-layout/main-layout.component';
import { ErrorComponent } from './shared/error/error.component';
import { AuthGuard } from './core/guards';
import { LandingComponent } from './pages/landing/landing.component';

export const routes: Routes = [
  // Landing page route
  {
    path: '',
    component: LandingComponent,
    pathMatch: 'full'
  },
  {
    path: 'landing',
    component: LandingComponent
  },
  // Auth routes (without layout wrapper)
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login.component').then(c => c.LoginComponent)
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register/register.component').then(c => c.RegisterComponent)
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./features/auth/forgot-password/forgot-password.component').then(c => c.ForgotPasswordComponent)
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./features/auth/reset-password/reset-password.component').then(c => c.ResetPasswordComponent)
  },
  {
    path: 'verify-email',
    loadComponent: () => import('./features/auth/verify-email/verify-email.component').then(c => c.VerifyEmailComponent)
  },
  // Application routes with layout
  {
    path: 'app',
    component: MainLayoutComponent,
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'profile',
        loadComponent: () => import('./features/auth/profile/profile.component').then(c => c.ProfileComponent),
        canActivate: [AuthGuard]
      },
      // Main routes
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
        path: 'roles',
        loadComponent: () => import('./features/roles/roles.component').then(c => c.RolesComponent),
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
