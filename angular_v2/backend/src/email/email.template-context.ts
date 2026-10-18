/**
 * Render context for the two live templates. One type per file, no
 * `Record<string, any>`: the previous tree's renderer took the context keys,
 * interpolated them unescaped into a `RegExp`, and escaped `<`, `>` and `"`
 * while forgetting `&` — so a display name containing `&` corrupted the message
 * and a context key containing a regex metacharacter compiled a different
 * pattern. Handlebars with a typed context removes both.
 */

/** Verify an address a user just gave us. Substituted as text. */
export type VerifyEmailContext = {
  readonly appName: string;
  readonly recipientName: string;
  readonly verificationUrl: string;
  readonly expiresInHours: number;
};

/** Change a password a user forgot. The link is a bearer credential. */
export type PasswordResetContext = {
  readonly appName: string;
  readonly recipientName: string;
  readonly resetUrl: string;
  readonly expiresInMinutes: number;
};

/**
 * Move an account to an address the member just asked for. The link is a bearer
 * credential AND it is the only place the pending address exists — see
 * `src/token/email-change-token.ts`.
 *
 * `pendingEmail` is in the body because the recipient has to be able to see WHICH
 * address they are about to move their account to without opening the link, and a
 * mail that says "confirm this address" without saying which one is the exact shape
 * of message an attacker sends. Handlebars escapes it like every other substitution.
 */
export type EmailChangeContext = {
  readonly appName: string;
  readonly recipientName: string;
  readonly pendingEmail: string;
  readonly confirmationUrl: string;
  readonly expiresInHours: number;
};

/**
 * The only three templates. The previous tree shipped nine: `base-layout.html`
 * (dead and broken — it used a `{{{content}}}` triple-stash against a renderer
 * that only understood `{{var}}`, and had an unmatched CSS brace), a welcome
 * mail and five privacy-ticket mails, none of which had a single caller. A
 * template with no caller is not documentation; it is a maintenance surface
 * that silently rots, so only what ships is kept.
 */
export type EmailTemplateName = 'verify-email' | 'password-reset' | 'email-change';

export type EmailTemplateContextFor<K extends EmailTemplateName> =
  K extends 'verify-email'
    ? VerifyEmailContext
    : K extends 'password-reset'
      ? PasswordResetContext
      : EmailChangeContext;

/** The token lifetimes, stated once. `expiresInHours`/`expiresInMinutes` in the
 * context must match the lifetime the issuing route actually grants — a mail
 * that says 24 hours and a token that dies in one is a support ticket. */
export const VERIFICATION_LINK_LIFETIME_HOURS = 24;
export const PASSWORD_RESET_LINK_LIFETIME_MINUTES = 60;

/**
 * The email-change link's lifetime is the VERIFICATION link's lifetime, derived
 * rather than retyped.
 *
 * `mintEmailChange` mints under the `email_verification` purpose (the `purpose`
 * CHECK admits no fourth kind — `src/token/email-change-token.ts` has the full
 * argument), so `DEFAULT_TOKEN_TTL_SECONDS` resolves to
 * `VERIFICATION_LINK_LIFETIME_HOURS` for it. Writing `24` here instead would be a
 * second copy of a number the route and the mail have to agree on, and the two
 * drifting is a support ticket rather than a test failure.
 */
export const EMAIL_CHANGE_LINK_LIFETIME_HOURS = VERIFICATION_LINK_LIFETIME_HOURS;

/** Where each flow's link lands. All three are frontend routes. */
export const VERIFICATION_PATH = '/verify-email';
export const PASSWORD_RESET_PATH = '/reset-password';

/**
 * Where the email-change link lands.
 *
 * **THE FRONTEND ROUTE FOR THIS DOES NOT EXIST YET**, and neither do the other two
 * — `frontend/src/app/app.routes.ts` currently mounts `login`, `access-denied`, the
 * authenticated shell (`profile`, `users`) and `**`. So this constant is a promise
 * about a page this repository has not built, exactly as `VERIFICATION_PATH` and
 * `PASSWORD_RESET_PATH` already are, and the link a member receives today lands on
 * the frontend's Not Found page until that route is written.
 *
 * It is stated here rather than inlined in the mail for the reason the other two are:
 * the path is the backend half of a journey whose frontend half is owned by somebody
 * else, and a link built from a literal is a rename nobody greps for. **A member
 * cannot complete an address change from mail alone until that route lands**, and
 * saying so here is better than shipping the endpoint and finding out.
 */
export const EMAIL_CHANGE_PATH = '/verify-email-change';