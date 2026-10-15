import { createHmac } from 'node:crypto';

/**
 * The tombstone: what an erased account's identifying columns become.
 *
 * ## WHY THE USER ID AND NOT THE EMAIL
 *
 * The obvious pseudonym is `HMAC(pepper, email)`. It is wrong, and the reason is
 * the attack it invites. An email address is drawn from a **small, enumerable
 * space** — the domains are public, the local parts are names — so any party
 * holding the pepper (or a copy of the tombstone table) can hash a candidate list
 * and confirm which one produced `deleted-<digest>`. That is a rainbow table with
 * a dictionary instead of a rainbow table with a rainbow table, and it recovers the
 * exact address a person asked to be forgotten. GDPR Art. 4(5) and CPRA
 * §1798.100(a)(3) both turn on the address no longer being *identifiable*, and a
 * reversible pseudonym is not anonymisation.
 *
 * `users.id` is a 122-bit `uuidv7()` minted by the database. There is nothing to
 * enumerate: a candidate space of 2^122 cannot be walked, and the value is not
 * derived from anything about the person. So the tombstone identifies **the row**,
 * which is what an auditor needs to correlate, and identifies **nothing about the
 * person**, which is what the erasure promised.
 *
 * ## WHY THE HMAC AND NOT A BARE HASH
 *
 * A bare `sha256(userId)` is not a secret: the id space, while too large to
 * enumerate blindly, is *printed* in every JWT this application mints, in every
 * `email_messages.user_id`, and in every URL a client fetches. Anyone holding a
 * tombstone table and one of those could recompute every digest. The HMAC makes
 * the digest a function of a key the reader does not hold, which is what makes
 * "deterministic" a property worth having: the same pepper always yields the same
 * tombstone, and a different pepper always yields a different one — so a rotated
 * pepper is visibly a different generation rather than silently the same table.
 *
 * ## WHY 32 HEX CHARACTERS
 *
 * HMAC-SHA256 emits 64 hex characters, and `deleted-` plus those is 72 — over the
 * 64-octet limit RFC 5321 puts on a local-part, which real relays do refuse.
 * 32 hex characters is 128 bits, far past the point where an attacker gains
 * anything from a second preimage, and `deleted-<32 hex>` is 40 octets. The shape
 * is also the thing `isAnonymizedRecipient` keys on, so it has to be narrow enough
 * to be recognisable and impossible to collide with by accident.
 */

/** The marker every machine-generated identifying value carries. */
export const TOMBSTONE_PREFIX = 'deleted-';

/** 128 bits of HMAC-SHA256, hex-encoded. See the note above on the 64-octet limit. */
export const TOMBSTONE_DIGEST_LENGTH = 32;

/**
 * Domain separation inside the HMAC.
 *
 * The pepper may be shared with another keyed purpose in a deployment; hashing a
 * bare `userId` under a key that another feature also uses would let that
 * feature's output be compared against this one. A fixed label inside the
 * message makes the two digests unrelated even when the key is the same.
 */
const DOMAIN_LABEL = 'privacy.erasure.subject.v1';

/** `deleted-` + exactly 32 lowercase hex characters. Nothing else is a tombstone. */
const TOMBSTONE_LOCAL_PART = new RegExp(`^${TOMBSTONE_PREFIX}[0-9a-f]{${String(TOMBSTONE_DIGEST_LENGTH)}}$`);

/**
 * The keyed digest of one subject's opaque id.
 *
 * Pure and total: it reads no clock, no environment and no database, so the
 * tombstone for a given `(userId, pepper)` pair is a value rather than a run.
 */
export function tombstoneDigest(userId: string, pepper: string): string {
  return createHmac('sha256', pepper)
    .update(`${DOMAIN_LABEL}${userId}`, 'utf8')
    .digest('hex')
    .slice(0, TOMBSTONE_DIGEST_LENGTH);
}

/**
 * The neutralised `users.username`, and the local part of the tombstone address.
 *
 * **One value for both, deliberately.** `username` is the login key
 * (`users.username` is UNIQUE and `AuthService.findUser` looks it up), so it has
 * to stop naming a person; and reusing the address's digest keeps a reader of the
 * row able to see that the two columns were rewritten together without a second
 * keyed value that could disagree with the first. Uniqueness holds because the
 * digest is a function of a unique id — two users cannot collide, and a collision
 * would abort the transaction with `23505` rather than silently merge two
 * tombstones.
 */
export function tombstoneLocalPart(userId: string, pepper: string): string {
  return `${TOMBSTONE_PREFIX}${tombstoneDigest(userId, pepper)}`;
}

/**
 * The replacement address.
 *
 * The domain is the operator's, configured, and required: an erasure must not
 * invent a destination, for the same reason `EMAIL_FROM` is derived rather than
 * defaulted elsewhere in this repository (§2.3).
 */
export function tombstoneAddress(userId: string, pepper: string, domain: string): string {
  return `${tombstoneLocalPart(userId, pepper)}@${domain}`;
}

/**
 * Is this recipient an anonymised tombstone?
 *
 * **Shape, not a lookup, and the trade is stated.** A database read would have to
 * happen on every send, would fail exactly when the row is gone (which is the case
 * that matters most), and would add a round trip to a path that currently has
 * none. The marker is instead carried by the address itself, so the check is
 * total, free and true after the row no longer exists.
 *
 * The cost is that it is a *shape*, so a real person who chose
 * `deleted-<32 hex>@…` as their address is refused mail — a denial, fail-closed,
 * against a pathological address. The alternative, keying on the configured
 * tombstone domain only, would be defeated by a tombstone on any other domain and
 * would put a configuration dependency into the single send path.
 *
 * The `Display Name <addr>` form is unwrapped first, because `isSingleLineAddress`
 * accepts it and a check that only understood the bare form would pass a
 * tombstone addressed in the delimited spelling.
 */
export function isAnonymizedRecipient(value: string): boolean {
  const delimited = /^(.*)<([^<>]*)>$/.exec(value);
  const address = delimited === null ? value : (delimited[2] ?? '');
  const at = address.lastIndexOf('@');
  if (at <= 0) {
    return false;
  }
  return TOMBSTONE_LOCAL_PART.test(address.slice(0, at).toLowerCase());
}