/**
 * A message the transport refused.
 *
 * `EmailService.sendEmail` **throws**. It does not return a boolean and it does
 * not return a discriminated result — one decision, applied everywhere:
 *
 * - The previous tree returned `boolean` from all eight send methods and
 *   `AuthService` discarded it, so a total SMTP failure produced `HTTP 200` and
 *   a user who never received their reset link. A success-shaped failure is the
 *   defect §2.3 names by name.
 * - A discriminated result would fix the *service* while leaving every future
 *   caller free to ignore the `failed` arm. A thrown error cannot be ignored
 *   without a `catch` that deliberately swallows it, which is visible in a
 *   diff.
 *
 * `recipient` is the address that failed — or `<rejected-recipient>` when the
 * address itself was refused, because an invalid address is attacker-controlled
 * and may carry a CRLF that would forge a log line in whatever handles this
 * error. `cause` carries the transport's own error, so a 535 auth failure and a
 * DNS failure remain distinguishable at the call site.
 */
export class EmailDeliveryError extends Error {
  readonly recipient: string;
  readonly subject: string;

  constructor(recipient: string, subject: string, cause: unknown) {
    const detail =
      cause instanceof Error ? cause.message : `a non-Error value: ${String(cause)}`;
    super(`the ${recipient} message "${subject}" was not accepted: ${detail}`, { cause });
    this.name = 'EmailDeliveryError';
    this.recipient = recipient;
    this.subject = subject;
  }
}