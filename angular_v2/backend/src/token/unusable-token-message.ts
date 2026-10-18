/**
 * The single message every failed one-time-token redemption gets.
 *
 * ## WHY THIS LIVES HERE AND NOT IN `auth.service.ts`
 *
 * It was `auth.service.ts`'s own constant, and there was exactly one consumer while
 * there was exactly one kind of link. There are now three redemption routes —
 * `POST /auth/password-reset/confirm`, `POST /auth/email-verification/confirm` and
 * `POST /users/me/email/confirm` — and the property that makes them safe is that all
 * three spend the SAME string on all four failure modes. Three copies of one sentence
 * would make that a coincidence between three authors rather than a fact about the
 * primitive, which is the difference between reading it once and reviewing it
 * forever (§2.4). It belongs to the primitive, so it lives beside it.
 *
 * ## One string, four failures
 *
 * Expired, already-redeemed, presented for the wrong purpose, and never issued at all
 * all reach the same `400` with this text, because the redemption path returns one
 * `invalid_or_expired` for all four and anything that branched on which one it was
 * would hand back the distinction the primitive spent its single-use design to
 * remove. A caller who learns *which* reason their link failed has learned whether
 * the link ever existed.
 *
 * It also says nothing about the account: a valid token does not get a friendlier
 * message either, because "that link worked" is itself the answer an attacker is
 * after and they already have it.
 */
export const UNUSABLE_TOKEN_MESSAGE =
  'this link is not valid, has already been used, or has expired — request a new one';
