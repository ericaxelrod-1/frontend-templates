import { randomUUID } from 'node:crypto';

/**
 * RFC 9562 version 7: a 48-bit big-endian `unix_ts_ms`, the version nibble, the
 * variant bits, and random bits in the remaining 74.
 *
 * This exists because one id cannot be left to a column default. The `jti` claim is
 * inside the access token, and the access token is what the refresh-token row is
 * keyed on, so the value has to exist before the row does — the database never gets
 * the chance to mint it. Everything else in the schema takes `uuidv7()` from a
 * `DEFAULT`, so this is the single place the application has to produce one, and it
 * produces the same kind of value a default would.
 *
 * The trailing bits are random rather than a monotonic counter, so two ids minted
 * within the same millisecond do not order by creation. That is accepted: time
 * ordering buys index locality, never uniqueness — the 74 random bits carry that —
 * and a monotonic counter needs shared state to be correct across processes.
 */

/** The timestamp field is 48 bits, so `2 ** 48` milliseconds is the exclusive ceiling. */
const TIMESTAMP_CEILING = 2 ** 48;

export function uuidv7(timestampMs: number = Date.now()): string {
  // Range-checked rather than truncated. The write below is `remaining % 256` six
  // times, which is silent arithmetic: `2 ** 48` wraps to a timestamp of 0 and `-1`
  // becomes `ffff_ffff_ffff`, so both mint a well-formed v7 carrying the wrong
  // time. A value that looks like a v7 is worse than one that never got made — the
  // time prefix is the entire reason this generator exists, and a zeroed one
  // destroys the ordering silently, with nothing anywhere reporting an error
  // (`AGENTS.md` §2.3). `Date.now()` cannot produce either value, so this is a guard
  // on the public parameter rather than on the caller.
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0 || timestampMs >= TIMESTAMP_CEILING) {
    throw new RangeError(
      `uuidv7 timestamp must be a safe integer in [0, 2^48) milliseconds, got ${String(timestampMs)}`,
    );
  }

  const bytes = Buffer.from(randomUUID().replaceAll('-', ''), 'hex');

  // Bytes 0..5 hold the timestamp most-significant-first, so fill from the end.
  let remaining = timestampMs;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }

  // Version nibble 7 in the high nibble of byte 6; variant 0b10 in byte 8.
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}