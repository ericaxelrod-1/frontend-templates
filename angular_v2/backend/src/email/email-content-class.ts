/**
 * Which templates may have their rendered body persisted, and which may not.
 *
 * **The rule.** `password_reset` and `email_verification` carry a bearer token
 * in the body — the reset and verification links ARE the credential. Storing the
 * body would put a working token in a table that an admin reads over HTTP, in
 * backups, and in every replica, turning a leak of the email history into a leak
 * of live account takeover. So those two templates are forced to
 * `content_class = 'metadata_only'` with `body` NULL, and this module is the only
 * thing that decides it.
 *
 * **Why a module and not a check in the service.** Because the decision has to be
 * reachable from the *audit write*, which runs on both the success and the failure
 * path, in a `finally`-shaped position where a branch is easy to miss. Keeping the
 * set of credential-bearing templates in one named constant means the rule is
 * stated once, is greppable, and is testable without a database.
 *
 * **It is enforced, not documented.** `contentClassFor` THROWS on a body offered
 * for a credential-bearing template rather than dropping it. Silently nulling the
 * column would make the caller believe a body was stored, and the failure would
 * surface as an empty `body` column with no indication that anything was refused —
 * which is the "looks finished and isn't" shape §2.1 forbids. A refusal is an
 * event the caller can see.
 */

/**
 * The templates whose rendered body contains a bearer credential.
 *
 * Named after the STORED `template` column value, which is why these are
 * `password_reset` / `email_verification` and not the renderer's `password-reset`
 * / `verify-email` file names. Two different vocabularies for two different
 * concerns, and the mapping is a deliberate edit rather than a coincidence.
 */
export const CREDENTIAL_BEARING_TEMPLATES: readonly string[] = [
  'password_reset',
  'email_verification',
];

/** How much of a message this application is willing to keep. */
export type EmailContentClass = 'metadata_only' | 'full_body';

/**
 * The class a template's persisted row must carry, and the body that may go with
 * it.
 *
 * Returns both together rather than letting the caller pick a class and a body
 * independently: every way of expressing "keep the body" separately from "this is
 * a full-body template" is a way of getting one of them wrong in the direction
 * that stores a token.
 *
 * @throws if a body is offered for a credential-bearing template.
 */
export function contentClassFor(
  template: string,
  body: string | null,
): { readonly contentClass: EmailContentClass; readonly body: string | null } {
  if (body !== null && CREDENTIAL_BEARING_TEMPLATES.includes(template)) {
    throw new Error(
      `refusing to persist a rendered body for template '${template}': it carries a bearer credential, so the stored row must stay content_class='metadata_only' with body NULL`,
    );
  }
  return body === null
    ? { contentClass: 'metadata_only', body: null }
    : { contentClass: 'full_body', body };
}
