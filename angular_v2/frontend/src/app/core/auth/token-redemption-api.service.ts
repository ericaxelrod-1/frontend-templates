import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { NEST_BASE_URL } from '../api/api-base-urls';
import type {
  EmailChangeConfirmRequest,
  EmailChangeConfirmed,
  EmailVerificationConfirmRequest,
  EmailVerificationConfirmed,
  PasswordResetConfirmRequest,
  PasswordResetConfirmed,
} from './token-redemption.types';

/**
 * Service handling one-time token redemption requests against the thin Nest app.
 *
 * ## UNAUTHENTICATED TOKEN REDEMPTION
 *
 * All three endpoints are public / unauthenticated because the token in the request body
 * IS the authentication credential:
 * - `POST /api/auth/email-verification/confirm`
 * - `POST /api/auth/password-reset/confirm`
 * - `POST /api/users/me/email/confirm`
 *
 * ## TOKENS MUST NEVER APPEAR IN URL QUERY PARAMETERS
 *
 * Tokens arrive in email links as query parameters on the frontend URL (`?token=...`),
 * but when redeemed against the backend API they must strictly be transmitted in the JSON POST
 * request body and NEVER appended to the API request URL or query string.
 */
@Injectable({ providedIn: 'root' })
export class TokenRedemptionApi {
  private readonly http = inject(HttpClient);

  /**
   * Redeems an email verification token.
   * `POST /api/auth/email-verification/confirm` -> `200 { status: 'verified' }`.
   */
  confirmEmailVerification(
    request: EmailVerificationConfirmRequest,
  ): Observable<EmailVerificationConfirmed> {
    return this.http.post<EmailVerificationConfirmed>(
      `${NEST_BASE_URL}/auth/email-verification/confirm`,
      request,
    );
  }

  /**
   * Redeems a password reset token with a newly chosen password.
   * `POST /api/auth/password-reset/confirm` -> `200 { status: 'password_reset' }`.
   */
  confirmPasswordReset(
    request: PasswordResetConfirmRequest,
  ): Observable<PasswordResetConfirmed> {
    return this.http.post<PasswordResetConfirmed>(
      `${NEST_BASE_URL}/auth/password-reset/confirm`,
      request,
    );
  }

  /**
   * Redeems an email change token.
   * `POST /api/users/me/email/confirm` -> `200 { status: 'email_changed' }`.
   */
  confirmEmailChange(
    request: EmailChangeConfirmRequest,
  ): Observable<EmailChangeConfirmed> {
    return this.http.post<EmailChangeConfirmed>(
      `${NEST_BASE_URL}/users/me/email/confirm`,
      request,
    );
  }
}
