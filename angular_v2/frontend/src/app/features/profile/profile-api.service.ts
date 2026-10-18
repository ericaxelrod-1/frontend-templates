import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { NEST_BASE_URL } from '../../core/api/api-base-urls';
import type { EmailChangeAccepted } from './email-change-accepted';
import type { EmailChangeRequest } from './email-change-request';
import type { ProfileLoginAttempt } from './login-attempt';
import type { PasswordChangeRequest } from './password-change-request';
import type { ProfileMe } from './profile-me';
import type { ProfileUpdateRequest } from './profile-update-request';

/**
 * Every call the member's own profile makes, against the thin Nest app.
 *
 * `AuthApi` is the other half of `/api` and this is deliberately not part of it:
 * `AuthApi` speaks about the session (`login`, `me`, `logout`), this speaks about
 * one account's own attributes. Two services over the same base path is not two
 * mechanisms — they answer different questions, and neither would survive being
 * the other's. There is no `catchError` in this file and no error is turned into a
 * success-shaped value: `401` is handled once, globally, by `authInterceptor`,
 * which clears the session and sends the browser to `/access-denied`, and every
 * other status reaches the form that made the call and is rendered there
 * (AGENTS.md §F4 — one error-handling strategy).
 *
 * ## These routes do not exist yet
 *
 * They are specified in the unit's endpoint contract and the backend is being
 * written in parallel, so until it lands each of these answers `404` from a
 * Fastify default-not-found handler. That is surfaced as "HTTP 404" on the page —
 * a truthful answer about a route that is not there yet — rather than being hidden
 * behind a default value.
 */
@Injectable({ providedIn: 'root' })
export class ProfileApi {
  private readonly http = inject(HttpClient);

  /** `GET /api/users/me` — the caller's own row, within their column grant. */
  me(): Observable<ProfileMe> {
    return this.http.get<ProfileMe>(`${NEST_BASE_URL}/users/me`);
  }

  /**
   * `PATCH /api/users/me` — the only columns a member may write for themselves, and
   * the response is the refreshed row rather than a bare `204`, so the page shows
   * what the DATABASE stored instead of what it submitted. A form that rendered its
   * own input back would report success for a value the server trimmed, refused or
   * normalised.
   */
  updateMe(request: ProfileUpdateRequest): Observable<ProfileMe> {
    return this.http.patch<ProfileMe>(`${NEST_BASE_URL}/users/me`, request);
  }

  /**
   * `POST /api/users/me/email` — asks for a new address, and asks for nothing
   * else. The `202` means "a verification link is on its way", not "your address is
   * now this"; the address changes only when the member opens that link.
   */
  requestEmailChange(request: EmailChangeRequest): Observable<EmailChangeAccepted> {
    return this.http.post<EmailChangeAccepted>(`${NEST_BASE_URL}/users/me/email`, request);
  }

  /** `POST /api/users/me/password` — answers `204` with no body. */
  changePassword(request: PasswordChangeRequest): Observable<void> {
    return this.http.post<void>(`${NEST_BASE_URL}/users/me/password`, request);
  }

  /**
   * `GET /api/users/me/login-attempts` — the caller's OWN attempts, matched by
   * `username` because `login_attempts` has no `user_id` and is deliberately text.
   * `username` is immutable, so the history does not fragment across a rename.
   */
  loginAttempts(): Observable<readonly ProfileLoginAttempt[]> {
    return this.http.get<readonly ProfileLoginAttempt[]>(`${NEST_BASE_URL}/users/me/login-attempts`);
  }
}