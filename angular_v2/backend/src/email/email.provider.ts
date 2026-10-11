/**
 * The email port, and the one injection token for it.
 *
 * A `Symbol`, not the bare string `'EmailProvider'` the previous tree used: a
 * string token is a global namespace shared with every other library in the
 * process, so a typo resolves to nothing at compile time and to somebody
 * else's provider at runtime.
 *
 * The interface is deliberately tiny — one message in, one receipt out. It
 * carries no template name and no `Record<string, any>` context: rendering is
 * the service's job and belongs to the renderer, so a provider cannot be handed
 * a template it is expected to find, and cannot be handed untyped values at all
 * (`AGENTS.md` §2.6).
 */

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

/** A fully rendered message. There is no template reference left to resolve. */
export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  /** Plain-text alternative. Clients that refuse HTML must still be able to
   * read the link, so this is derived, never optional. */
  readonly text: string;
};

/**
 * Proof of acceptance, returned only when the transport accepted the message.
 * There is deliberately no `success: boolean`: the previous tree's
 * `SendEmailResult` carried one, `EmailService` returned it, and `AuthService`
 * discarded it — so a total send failure became HTTP 200 (`AGENTS.md` §2.3).
 *
 * There is no `transport` label and no `serialised` body either. There is one
 * transport, so naming it on every receipt asserted a fact that is now a
 * constant, and the serialised MIME belonged to the test-only JSON transport,
 * which had no analogue over SMTP. **A `250` is not a delivery receipt**, so a
 * receipt that claims to be one would be the wrong shape to keep (ADR-0024).
 */
export type SentEmail = {
  readonly messageId: string;
};

export interface EmailProvider {
  readonly name: string;

  /**
   * Resolves only when the message was accepted by the transport.
   * Any failure rejects; this interface has no failure-shaped success.
   */
  send(message: EmailMessage): Promise<SentEmail>;
}