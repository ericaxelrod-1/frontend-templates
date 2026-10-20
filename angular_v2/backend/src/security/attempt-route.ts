import type { AttemptKind } from '../auth/auth.service.js';
import {
  AUTH_EMAIL_VERIFICATION_REQUEST,
  AUTH_LOGIN,
  AUTH_PASSWORD_RESET_REQUEST,
} from '../breaker/dispatch-token.js';

/**
 * The routes that are ATTEMPTS AT SOMETHING, and the body field that names what
 * was attempted.
 *
 * ## WHY THIS IS A TABLE AND NOT AN INFERENCE
 *
 * `security_detected_patterns.unique_email_count` counts the DISTINCT IDENTITIES a
 * pattern touched, and `pattern_login_attempts` links a pattern to the attempt
 * rows that prove it. Both need to know which identity a request was aimed at,
 * and only two routes in this application have one: the sign-in route (the
 * username) and the two one-time-token request routes (the address).
 *
 * The table is keyed on the DISPATCH TOKEN, which is the vocabulary the rest of
 * the application already uses to name a route (`src/breaker/dispatch-token.ts`).
 * The token for a route is derived from the controller and handler names by
 * `dispatchTokenForRoute`, so a route that is renamed without being re-listed here
 * stops being an attempt route — visibly, because the collector then records no
 * subject and the pattern row's `unique_email_count` stays zero.
 *
 * ## WHY THE ADDRESS IS NORMALISED THE SAME WAY THE AUTH SERVICE NORMALISES IT
 *
 * `AuthService.requestToken` records the address as `dto.email.trim().toLowerCase()`
 * in `login_attempts.username`. The flush joins the attempt rows back to the
 * pattern by that value, so the subject recorded here has to be normalised
 * identically — otherwise a pattern would never find the attempt it belongs to,
 * and the link would be silently absent rather than visibly wrong.
 */
export type AttemptRoute = {
  /** The body field that names what was attempted. */
  readonly field: string;
  /** The `login_attempts.attempt_kind` the attempt is recorded under. */
  readonly kind: AttemptKind;
};

/**
 * The attempt routes.
 *
 * **A route that is not in here is not an attempt**, and a detection on it is
 * recorded as a pattern with no subject: the pattern still exists, it simply has
 * no identity to count and no attempt to link to. That is the honest state, and
 * it is why the table is a whitelist rather than a default.
 */
export const ATTEMPT_ROUTES: Readonly<Record<string, AttemptRoute>> = Object.freeze({
  [AUTH_LOGIN]: { field: 'username', kind: 'login' },
  [AUTH_PASSWORD_RESET_REQUEST]: { field: 'email', kind: 'token_request' },
  [AUTH_EMAIL_VERIFICATION_REQUEST]: { field: 'email', kind: 'token_request' },
});

/**
 * The subject as `login_attempts.username` records it.
 *
 * One function, because the normalisation is the JOIN KEY between the pattern and
 * the attempt row and two copies of it would drift — which is the failure this
 * file exists to prevent.
 */
export function normaliseAttemptSubject(kind: AttemptKind, subject: string): string {
  return kind === 'token_request' ? subject.trim().toLowerCase() : subject;
}
