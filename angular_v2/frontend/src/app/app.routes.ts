import type { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

/**
 * The route table. Every entry here has a component behind it — a nav entry that
 * points at a route nobody built is a feature that looks finished and is not
 * (AGENTS.md §2.1), so the shell's links are generated from this same list rather
 * than maintained beside it.
 *
 * `''` is a layout route carrying the guard, so the guard covers the whole
 * authenticated area in one place and a future child cannot be added outside it
 * by accident.
 *
 * `/` redirects to `/users` explicitly. It is not a catch-all and it does not
 * swallow a URL the application cannot serve: `**` is last, and it renders the
 * Not Found page.
 */
export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in',
    loadComponent: () => import('./features/auth/login-page/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'access-denied',
    title: 'Access denied',
    loadComponent: () =>
      import('./features/errors/access-denied-page/access-denied-page').then(
        (m) => m.AccessDeniedPage,
      ),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layouts/app-shell/app-shell').then((m) => m.AppShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'users' },
      {
        path: 'users',
        title: 'Users',
        loadComponent: () =>
          import('./features/users/users-page/users-page').then((m) => m.UsersPage),
      },
    ],
  },
  {
    path: '**',
    title: 'Page not found',
    loadComponent: () =>
      import('./features/errors/not-found-page/not-found-page').then((m) => m.NotFoundPage),
  },
];