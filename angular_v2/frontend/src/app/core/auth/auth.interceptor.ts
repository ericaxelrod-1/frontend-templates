import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { Session } from './session.service';

/**
 * Attaches the access token and reacts to the one API answer that means the
 * session itself is finished.
 *
 * ## `401` and not `403`
 *
 * `401` on a request that carried a token means the API would not accept that
 * token — it expired, it was revoked, or it was signed with a different secret.
 * The local session is therefore a lie, so it is dropped and the browser is sent
 * to `/access-denied`.
 *
 * `403` is NOT treated that way, and the distinction is load-bearing. `403` is
 * how PostgREST reports a principal that is authenticated but not granted the
 * table: an `app_member` reading `user_roles` gets exactly that (the capability
 * axis is admin-only at the table level — `0001_rls_foundation.sql`), and it is a
 * correct answer about a perfectly healthy session. Clearing the session on it
 * would sign a member out for asking a question the schema is designed to refuse.
 * It propagates to the caller, which renders it.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const session = inject(Session);
  const router = inject(Router);
  const accessToken = session.accessToken();

  const authorized =
    accessToken === null
      ? request
      : request.clone({ setHeaders: { Authorization: `Bearer ${accessToken}` } });

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && accessToken !== null) {
        session.clear();
        void router.navigateByUrl('/access-denied');
      }
      return throwError(() => error);
    }),
  );
};