import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { NEST_BASE_URL } from '../api/api-base-urls';
import type {
  AuthCaptchaChallenge,
  AuthLoginRequest,
  AuthLogoutRequest,
  AuthMe,
  AuthTokens,
} from './auth.types';

/**
 * Every call to the thin Nest app. The CRUD layer is PostgREST's job and lives in
 * the feature services; this is the only place that speaks to `/api`.
 *
 * `me` is not `@Public()` (backend/src/auth/auth.controller.ts), so it carries the
 * access token through `authInterceptor` like any other call.
 */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  login(request: AuthLoginRequest): Observable<AuthTokens> {
    return this.http.post<AuthTokens>(`${NEST_BASE_URL}/auth/login`, request);
  }

  /**
   * Asks for a challenge.
   *
   * **It is called only when the server has already said one is required** — the
   * login route answers `428 Precondition Required` when the gate decides the
   * request is above the risk threshold. Asking for one beforehand would put a
   * challenge in front of every sign-in, which is the blanket challenge
   * `docs/security.md` names as the anti-pattern.
   */
  issueCaptcha(): Observable<AuthCaptchaChallenge> {
    return this.http.post<AuthCaptchaChallenge>(`${NEST_BASE_URL}/auth/captcha`, {});
  }

  me(): Observable<AuthMe> {
    return this.http.get<AuthMe>(`${NEST_BASE_URL}/auth/me`);
  }

  /** Revokes the refresh token server-side. Answers `204` with no body. */
  logout(request: AuthLogoutRequest): Observable<void> {
    return this.http.post<void>(`${NEST_BASE_URL}/auth/logout`, request);
  }
}