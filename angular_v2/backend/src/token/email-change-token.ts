/**
 * The email-change token's FORMAT: a versioned composite token that carries the
 * address the member asked for.
 *
 * ## WHY THIS FILE EXISTS AT ALL, AND WHY IT IS NOT A COLUMN ON `users`
 *
 * A two-phase address change has to remember one thing between "the member asked"
 * and "the member proved it": **which address they asked for**. `users` cannot
 * hold it, for three reasons that each independently close the question:
 *
 *   * `0023_user_profile_and_disable.sql` grants `app_member` a COLUMN list on
 *     `users` — twelve columns — and the frontend's generated type is pinned to
 *     them. A thirteenth column means rewriting the grant, the type and the page,
 *     for a value that is not part of the account until it is verified.
 *   * A pending address on the row would have to be excluded from every read of the
 *     row (it is not the account's address, so the member's own `GET /users/me`
 *     would be reporting something that is not in force), which means either a
 *     policy that hides a row based on a column — RLS decides ROWS, so that hides
 *     the whole account — or a filtered projection at every reader.
 *   * Nothing enforces "the pending address is the one in force", because a column
 *     is a value rather than a transition. The transition is the whole of the
 *     control.
 *
 * ## AND WHY IT IS NOT A COLUMN ON `auth_tokens` EITHER
 *
 * `0018_auth_tokens.sql` records the table's own rationale: `subject_hmac` exists
 * "without persisting raw PII (such as plaintext email addresses)", and
 * `subject_hmac` is an HMAC — one way. A pending address parked in a new column on
 * that table would be plaintext PII in the one table whose design says it holds
 * none, and it would have to be added by a migration.
 *
 * **So the address travels inside the token itself, and nowhere else.** A link is
 * a bearer credential that is delivered to one mailbox and stored nowhere, which is
 * exactly the lifetime this value needs: it exists from the moment the member asks
 * until they redeem the link or it expires.
 *
 * ## WHY THE PAYLOAD IS INSIDE THE HASHED STRING AND NOT BESIDE IT
 *
 * `TokenService.hashToken` HMACs the **whole** raw token. So the payload is not
 * merely carried, it is **authenticated**: changing one character of the address
 * changes the digest, and the digest is what the lookup matches. A caller cannot
 * mint a token for `victim@example.test` and present it for `attacker@example.test`
 * — the second attempt matches no row. That is a stronger property than a payload
 * column beside an authenticated id, where the two values could disagree.
 *
 * ## WHY THE PREFIX IS THE FLOW DISCRIMINATOR, AND WHAT IT DOES NOT DO
 *
 * `auth_tokens.purpose` is `CHECK (purpose IN ('password_reset', 'email_verification',
 * 'account_deletion'))` (`0018:83`), and `authz.mint_auth_token` raises on anything
 * outside that set (`0018:125`). Naming a fourth kind `email_change` therefore needs
 * a migration to the constraint AND to the function's guard, which this unit does not
 * write. The row consequently carries `email_verification`, and the FLOW is
 * distinguished in two places instead:
 *
 *   1. **The prefix, checked before any database call.** `readEmailChangeToken`
 *      returns `null` for a value that does not carry `ec1.`, and a bare
 *      `TokenService.redeem` refuses a value that DOES. Each route therefore
 *      consumes only its own shape, so a verification link posted to the
 *      email-change route is refused **without being consumed** — which is the
 *      property that stops the wrong endpoint destroying a live link.
 *   2. **A domain-separated `subject_hmac`, keyed on the USER rather than on the
 *      address.** See `emailChangeSubject` for why that is what makes superseding
 *      work.
 *
 * What it does NOT do is satisfy the `purpose` CHECK, and that is recorded as the
 * deviation it is rather than presented as parity.
 */

/**
 * Version prefix, `ec1.` — version first so a future format can be added beside this
 * one and the old links keep failing closed rather than being silently reinterpreted.
 *
 * `.` is the separator because it is not in the base64url alphabet
 * (`A–Z a–z 0–9 - _`), so a split on it cannot be thrown off by the payload.
 */
export const EMAIL_CHANGE_TOKEN_PREFIX = 'ec1.';

/**
 * The subject namespace for an email-change token's HMAC.
 *
 * ## WHY THE SUBJECT IS THE USER AND NOT THE ADDRESS
 *
 * `subject_hmac` is the key `authz.invalidate_auth_tokens` matches on, and it is how
 * a flow "closes the set of links it belongs to" — the same job
 * `invalidateOtherResetLinks` does after a password reset. To SUPERSEDE an
 * outstanding email-change request without knowing what address it was for, the
 * subject has to be something the requester already knows: the member's own id.
 *
 * A pending address is exactly the one thing nobody knows: the request that
 * supersedes it does not carry the address it is superseding, and the address is not
 * stored anywhere. Keying on the address would make supersession impossible without
 * a column — which is the same missing column this file exists to avoid.
 *
 * ## WHY THE NAMESPACE CANNOT COLLIDE WITH A VERIFICATION TOKEN'S
 *
 * Verification and reset tokens are minted with `hashSubject(user.email)`, so their
 * subject is the lowercased address. This one is `email-change:<uuid>`. A collision
 * would need a registered address literally equal to `email-change:<uuid>`, which is
 * not an address — it has no `@` — and `TokenRequestDto`/`CreateUserDto` both refuse
 * one at the boundary. The namespaces are therefore disjoint by construction rather
 * than by a comment, and superseding a change can never burn a verification link.
 */
export const EMAIL_CHANGE_SUBJECT_PREFIX = 'email-change:';

/**
 * The longest pending address this flow will mint for.
 *
 * **255, and it is the width of `users.email`'s neighbour `users.username`** — the
 * same reasoning `TokenRequestDto` gives for its own `@MaxLength(255)`: "an address
 * longer than this is not an address". It is also what keeps the composite token
 * inside a sane size: the payload is base64url of the address, so the bound is what
 * bounds the URL a mail client has to carry.
 */
export const MAX_PENDING_EMAIL_LENGTH = 255;

/** Entropy in the token's secret half: 32 bytes, the same `randomBytes(32)` every other flow mints. */
const SECRET_BYTES = 32;

/** base64url length of `n` bytes, unpadded. `4·⌊n/3⌋` plus the 2-or-3-character tail. */
function base64UrlLength(byteLength: number): number {
  const groups = Math.floor(byteLength / 3);
  const remainder = byteLength % 3;
  return groups * 4 + (remainder === 0 ? 0 : remainder + 1);
}

/** The composite token's floor: prefix, a one-byte payload, separator, and a 32-byte secret. */
export const EMAIL_CHANGE_TOKEN_MIN_LENGTH =
  EMAIL_CHANGE_TOKEN_PREFIX.length + base64UrlLength(1) + 1 + base64UrlLength(SECRET_BYTES);

/** The composite token's ceiling: prefix, a 255-byte payload, separator, and the secret. */
export const EMAIL_CHANGE_TOKEN_MAX_LENGTH =
  EMAIL_CHANGE_TOKEN_PREFIX.length +
  base64UrlLength(MAX_PENDING_EMAIL_LENGTH) +
  1 +
  base64UrlLength(SECRET_BYTES);

/**
 * Prefixes that mark a raw token as COMPOSITE, and therefore as redeemable only by
 * the method that owns its format.
 *
 * **This list is what stops one flow from consuming another's link.** Because
 * `auth_tokens.purpose` cannot name `email_change` without a migration, an
 * email-change token and an address-verification token are the same `purpose` as far
 * as `authz.redeem_auth_token` is concerned, and a bare `redeem` would happily
 * consume an email-change link and report success — destroying the pending change
 * and handing back a `200` that says nothing happened. `TokenService.redeem` refuses
 * every prefix named here BEFORE it hashes anything, so the bare flows cannot reach
 * a composite row at all.
 *
 * A new composite format adds one line here and one prefix constant of its own.
 */
export const COMPOSITE_TOKEN_PREFIXES: readonly string[] = [EMAIL_CHANGE_TOKEN_PREFIX];

/** Does this raw value carry a composite format marker? */
export function isCompositeToken(rawToken: string): boolean {
  return COMPOSITE_TOKEN_PREFIXES.some((prefix) => rawToken.startsWith(prefix));
}

/**
 * The canonical form of a requested address: trimmed and lowercased.
 *
 * Identical to the normalisation `AuthService.requestToken` applies before it looks
 * an address up, and it has to be identical because the value is stored in the token
 * and written straight to `users.email` on redemption — a normalisation applied on
 * the way in and not on the way out would write an address that differs from the one
 * that was verified.
 */
export function normalizePendingEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** The `subject_hmac` pre-image for this member's outstanding email-change links. */
export function emailChangeSubject(userId: string): string {
  return `${EMAIL_CHANGE_SUBJECT_PREFIX}${userId}`;
}

/**
 * Build the raw token. `pendingEmail` must already be normalised — callers go
 * through `normalizePendingEmail`, and `mintEmailChange` does it again so a future
 * caller cannot skip it.
 *
 * The secret is `randomBytes(32)` from `node:crypto`, the same entropy and the same
 * encoding as every other flow, so there is no second way to mint a token in this
 * tree (§2.4).
 */
export function encodeEmailChangeToken(pendingEmail: string, secret: string): string {
  if (secret.length !== base64UrlLength(SECRET_BYTES)) {
    throw new Error(
      `the email-change token's secret half must be ${String(SECRET_BYTES)} random bytes encoded as base64url ` +
        `(${String(base64UrlLength(SECRET_BYTES))} characters), received ${String(secret.length)}`,
    );
  }
  const payload = Buffer.from(pendingEmail, 'utf8').toString('base64url');
  return `${EMAIL_CHANGE_TOKEN_PREFIX}${payload}.${secret}`;
}

/**
 * The pending address inside a raw token, or `null` when the value is not one of
 * ours.
 *
 * ## WHY EVERY FAILURE IS `null` AND NOT A REASON
 *
 * Four things can be wrong — no prefix, wrong segment count, a payload that is not
 * canonical base64url, a payload whose decoded bytes are not UTF-8 — and they all
 * answer `null`, for the reason `AuthService`'s `UNUSABLE_TOKEN_MESSAGE` gives: a
 * caller who learns which kind of wrong their link was has learned something about a
 * link whose validity is the thing being protected.
 *
 * ## WHY THE DECODE IS RE-ENCODED AND COMPARED
 *
 * `Buffer.from(x, 'base64url')` is lenient: it silently drops characters outside the
 * alphabet, so `'ab$cd'` decodes as if it were `'abcd'`. The payload is
 * authenticated by the HMAC over the whole raw token, so a lenient decode cannot
 * produce a wrong address that is then applied — the digest would not match any row.
 * The re-encode is here so the parse is TOTAL and every rejection is a rejection of
 * the FORMAT, which is what makes the length window in the confirm DTO and the window
 * here the same window rather than two windows that happen to agree today.
 */
export function readEmailChangeToken(rawToken: string): string | null {
  if (!rawToken.startsWith(EMAIL_CHANGE_TOKEN_PREFIX)) {
    return null;
  }
  if (rawToken.length < EMAIL_CHANGE_TOKEN_MIN_LENGTH || rawToken.length > EMAIL_CHANGE_TOKEN_MAX_LENGTH) {
    return null;
  }
  const segments = rawToken.slice(EMAIL_CHANGE_TOKEN_PREFIX.length).split('.');
  if (segments.length !== 2) {
    return null;
  }
  const [payload, secret] = segments;
  if (payload === undefined || secret === undefined || secret.length !== base64UrlLength(SECRET_BYTES)) {
    return null;
  }
  const bytes = Buffer.from(payload, 'base64url');
  if (bytes.toString('base64url') !== payload) {
    return null;
  }
  const pendingEmail = bytes.toString('utf8');
  // Round-tripping UTF-8 is what proves the bytes are UTF-8: a decode that produced
  // U+FFFD would re-encode to different bytes, and the comparison below would fail.
  return Buffer.from(pendingEmail, 'utf8').equals(bytes) ? pendingEmail : null;
}
