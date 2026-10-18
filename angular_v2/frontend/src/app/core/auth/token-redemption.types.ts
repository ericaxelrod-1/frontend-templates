import { HttpErrorResponse } from '@angular/common/http';

/**
 * The shapes exchanged with the thin Nest app's one-time token confirmation routes.
 *
 * ## CONTRACT IS HAND-WRITTEN TO MIRROR BACKEND DTOs
 *
 * As documented in `auth.types.ts` and `email-change-accepted.ts`, `openapi-typescript`
 * generates `src/app/api/schema.ts` exclusively for PostgREST CRUD endpoints from `openapi.json`.
 * The Nest application layer uses `@ApiProperty()` on its own DTOs and does not participate
 * in PostgREST schema generation. Therefore, these interfaces are strict, hand-written mirrors
 * of the corresponding Nest backend DTOs:
 * - `EmailVerificationConfirmDto` / `EmailVerificationConfirmedDto`
 * - `PasswordResetConfirmDto` / `PasswordResetConfirmedDto`
 * - `EmailChangeConfirmDto` / `EmailChangeConfirmedDto`
 */

/** Mirrors `backend/src/auth/email-verification-confirm.dto.ts`. */
export interface EmailVerificationConfirmRequest {
  readonly token: string;
}

/** Mirrors `backend/src/auth/email-verification-confirmed.dto.ts`. */
export interface EmailVerificationConfirmed {
  readonly status: 'verified';
}

/**
 * Mirrors `backend/src/auth/password-reset-confirm.dto.ts`.
 *
 * Note: The DTO field for the new password is `password`, matching `PasswordResetConfirmDto`
 * (`backend/src/auth/password-reset-confirm.dto.ts:40`).
 */
export interface PasswordResetConfirmRequest {
  readonly token: string;
  readonly password: string;
}

/** Mirrors `backend/src/auth/password-reset-confirmed.dto.ts`. */
export interface PasswordResetConfirmed {
  readonly status: 'password_reset';
}

/** Mirrors `backend/src/users/email-change-confirm.dto.ts`. */
export interface EmailChangeConfirmRequest {
  readonly token: string;
}

/** Mirrors `backend/src/users/email-change-confirmed.dto.ts`. */
export interface EmailChangeConfirmed {
  readonly status: 'email_changed';
}

/**
 * Reads the `message` field from an `HttpErrorResponse` body without unsafe casting.
 *
 * NestJS `ValidationPipe` and `HttpException` responses format errors as
 * `{ statusCode, message, error }`, where `message` is either a single string or an array
 * of validation strings.
 */
export function extractTokenErrorMessage(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }
  const body: unknown = error.error;
  if (typeof body !== 'object' || body === null || !('message' in body)) {
    return null;
  }
  const message: unknown = (body as { readonly message: unknown }).message;
  if (typeof message === 'string' && message !== '') {
    return message;
  }
  if (Array.isArray(message)) {
    const parts: string[] = [];
    for (const part of message as readonly unknown[]) {
      if (typeof part === 'string' && part !== '') {
        parts.push(part);
      }
    }
    return parts.length > 0 ? parts.join('; ') : null;
  }
  return null;
}
