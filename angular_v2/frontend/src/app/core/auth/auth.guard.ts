import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { Session } from './session.service';

/**
 * The guard for the authenticated area.
 *
 * Default deny: no session, no route. The redirect target is `/login` and the
 * return value is a `UrlTree`, so the route is never entered and then bounced —
 * and it is never a silent `redirectTo: '/'` (AGENTS.md §F7).
 *
 * It reads only `isAuthenticated()`, which is a synchronous read of the token
 * restored at construction. A guard that had to await `/auth/me` first would
 * report "signed out" during the await and reject a valid deep link on every
 * reload; the identity is not part of the question this guard answers.
 */
export const authGuard: CanActivateFn = () => {
  const session = inject(Session);
  if (session.isAuthenticated()) {
    return true;
  }
  return inject(Router).createUrlTree(['/login']);
};