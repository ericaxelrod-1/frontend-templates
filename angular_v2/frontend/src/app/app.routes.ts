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
 * `/` redirects to `/profile`, and the choice is about the two pages' AUDIENCES
 * rather than about convenience. `/profile` is the one route every signed-in
 * member can use — `GET /api/users/me` is their own row, within their own column
 * grant — while `/users` answers a question only an administrator is asking. Every
 * user holds at least one role (AGENTS.md §B2), so there is no signed-in user for
 * whom `/profile` 403s; there is one for whom `/users` shows a single row of their
 * own and a list of columns it may not read.
 *
 * `/users` is NOT behind a role guard, and that is deliberate. A frontend guard
 * would be a second authorization mechanism disagreeing with the database's own
 * answer, and §F7 is explicit that permission checks in the frontend are a UX
 * affordance and never access control. The page instead asks for the columns the
 * signed-in grant can name and renders "not readable for this role" for the rest,
 * so what a role can see is a fact on the screen rather than a redirect. The shell
 * still hides the link from a member — see `app-shell.ts`.
 *
 * `/` is not a catch-all and it does not swallow a URL the application cannot
 * serve: `**` is last, and it renders the Not Found page.
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
    path: 'verify-email',
    title: 'Verify email',
    loadComponent: () =>
      import('./features/auth/verify-email-page/verify-email-page').then((m) => m.VerifyEmailPage),
  },
  {
    path: 'reset-password',
    title: 'Reset password',
    loadComponent: () =>
      import('./features/auth/reset-password-page/reset-password-page').then(
        (m) => m.ResetPasswordPage,
      ),
  },
  {
    path: 'verify-email-change',
    title: 'Verify email change',
    loadComponent: () =>
      import('./features/auth/verify-email-change-page/verify-email-change-page').then(
        (m) => m.VerifyEmailChangePage,
      ),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layouts/app-shell/app-shell').then((m) => m.AppShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'profile' },
      {
        path: 'profile',
        title: 'My profile',
        loadComponent: () =>
          import('./features/profile/profile-page').then((m) => m.ProfilePage),
      },
      {
        path: 'users',
        title: 'Users',
        loadComponent: () =>
          import('./features/users/users-page/users-page').then((m) => m.UsersPage),
      },
      {
        path: 'admin/security-alerts',
        title: 'Security alerts',
        loadComponent: () =>
          import('./features/security/security-alerts-page/security-alerts-page').then(
            (m) => m.SecurityAlertsPage,
          ),
      },
      {
        path: 'admin/ip-reputation',
        title: 'IP reputation',
        loadComponent: () =>
          import('./features/security/ip-reputation-page/ip-reputation-page').then(
            (m) => m.IpReputationPage,
          ),
      },
      {
        path: 'admin/pattern-detection',
        title: 'Pattern detection',
        loadComponent: () =>
          import('./features/security/pattern-detection-page/pattern-detection-page').then(
            (m) => m.PatternDetectionPage,
          ),
      },
      {
        path: 'admin/login-monitoring',
        title: 'Login monitoring',
        loadComponent: () =>
          import('./features/security/login-monitoring-page/login-monitoring-page').then(
            (m) => m.LoginMonitoringPage,
          ),
      },
      {
        path: 'admin/login-attempts',
        title: 'Login attempts',
        loadComponent: () =>
          import('./features/security/login-attempts-page/login-attempts-page').then(
            (m) => m.LoginAttemptsPage,
          ),
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