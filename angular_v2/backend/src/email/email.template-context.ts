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
 * The only two templates. The previous tree shipped nine: `base-layout.html`
 * (dead and broken — it used a `{{{content}}}` triple-stash against a renderer
 * that only understood `{{var}}`, and had an unmatched CSS brace), a welcome
 * mail and five privacy-ticket mails, none of which had a single caller. A
 * template with no caller is not documentation; it is a maintenance surface
 * that silently rots, so only what ships is kept.
 */
export type EmailTemplateName = 'verify-email' | 'password-reset';

export type EmailTemplateContextFor<K extends EmailTemplateName> =
  K extends 'verify-email' ? VerifyEmailContext : PasswordResetContext;

/** The token lifetimes, stated once. `expiresInHours`/`expiresInMinutes` in the
 * context must match the lifetime the issuing route actually grants — a mail
 * that says 24 hours and a token that dies in one is a support ticket. */
export const VERIFICATION_LINK_LIFETIME_HOURS = 24;
export const PASSWORD_RESET_LINK_LIFETIME_MINUTES = 60;

/** Where each flow's link lands. Both are frontend routes. */
export const VERIFICATION_PATH = '/verify-email';
export const PASSWORD_RESET_PATH = '/reset-password';