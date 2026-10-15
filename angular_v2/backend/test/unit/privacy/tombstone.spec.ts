import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  TOMBSTONE_DIGEST_LENGTH,
  TOMBSTONE_PREFIX,
  isAnonymizedRecipient,
  tombstoneAddress,
  tombstoneDigest,
  tombstoneLocalPart,
} from '../../../src/privacy/tombstone.js';

/**
 * The tombstone, as a value.
 *
 * Pure logic, no database and no clock, which is the whole reason it lives in its
 * own module: the property that matters — **the pepper is doing something** — is a
 * statement about two runs with two keys, and it is provable here and only here.
 */

const USER = '018f3c2a-1b4d-7c8e-9f01-23456789abcd';
const OTHER_USER = '018f3c2a-1b4d-7c8e-9f01-23456789abce';
const PEPPER = 'a-test-pepper-of-a-plausible-length-000001';
const OTHER_PEPPER = 'a-different-pepper-of-the-same-length-2';
const DOMAIN = 'tombstone.example.test';

describe('the tombstone is a value, not a run', () => {
  it('is the same for the same pepper, which is what lets an operator correlate a tombstone back to a row', () => {
    expect(tombstoneDigest(USER, PEPPER)).toBe(tombstoneDigest(USER, PEPPER));
    expect(tombstoneLocalPart(USER, PEPPER)).toBe(tombstoneLocalPart(USER, PEPPER));
    expect(tombstoneAddress(USER, PEPPER, DOMAIN)).toBe(tombstoneAddress(USER, PEPPER, DOMAIN));
  });

  it('DIFFERS for a different pepper, which is the assertion the key exists for', () => {
    // THE assertion this file exists for. Drop the key from the HMAC — replace
    // `createHmac('sha256', pepper)` with a bare `sha256` — and this equality is
    // what goes red, while every other test in this file stays green. A keyed
    // digest nobody varies is a keyed digest nobody has checked.
    expect(tombstoneDigest(USER, PEPPER)).not.toBe(tombstoneDigest(USER, OTHER_PEPPER));
    expect(tombstoneLocalPart(USER, PEPPER)).not.toBe(tombstoneLocalPart(USER, OTHER_PEPPER));
    expect(tombstoneAddress(USER, PEPPER, DOMAIN)).not.toBe(tombstoneAddress(USER, OTHER_PEPPER, DOMAIN));
  });

  it('is NOT the unkeyed hash of the id, so the id space cannot be walked offline', () => {
    // The concrete harm `pepper` prevents, stated as an equality rather than as
    // prose: `users.id` appears in every JWT this application mints, in every
    // `email_messages.user_id` and in every URL a client fetches, so anyone holding
    // a tombstone table plus one of those could recompute an unkeyed digest.
    const unkeyed = createHash('sha256').update(USER, 'utf8').digest('hex').slice(0, TOMBSTONE_DIGEST_LENGTH);

    expect(tombstoneDigest(USER, PEPPER)).not.toBe(unkeyed);
  });

  it('differs per subject, so two accounts cannot collide on the username it also writes', () => {
    // `users.username` is UNIQUE, so this is what makes the neutralised username
    // safe to write: a collision would abort the transaction with `23505` rather
    // than silently merge two tombstones.
    expect(tombstoneLocalPart(USER, PEPPER)).not.toBe(tombstoneLocalPart(OTHER_USER, PEPPER));
  });

  it('is 128 bits of lowercase hex behind the marker, and the whole local part fits a mailbox', () => {
    expect(TOMBSTONE_DIGEST_LENGTH).toBe(32);
    expect(tombstoneDigest(USER, PEPPER)).toMatch(/^[0-9a-f]{32}$/);

    // RFC 5321 caps a local-part at 64 octets. A full HMAC-SHA256 hex digest plus
    // the marker is 72, which real relays refuse — so the truncation is a
    // correctness requirement and not a tidiness choice.
    const localPart = tombstoneLocalPart(USER, PEPPER);
    expect(localPart.startsWith(TOMBSTONE_PREFIX)).toBe(true);
    expect(Buffer.byteLength(localPart, 'utf8')).toBeLessThanOrEqual(64);
  });

  it('mints the address in the CONFIGURED domain rather than one this code invents', () => {
    expect(tombstoneAddress(USER, PEPPER, DOMAIN)).toBe(`${tombstoneLocalPart(USER, PEPPER)}@${DOMAIN}`);
    expect(tombstoneAddress(USER, PEPPER, 'other.example.test')).not.toBe(
      tombstoneAddress(USER, PEPPER, DOMAIN),
    );
  });

  it('carries the email nowhere: two subjects differing only in everything but their id agree', () => {
    // The function has no email parameter, and that is the design: hashing the
    // address would be a dictionary attack over a small, enumerable space, and the
    // address is exactly what the erasure promised nobody could recover.
    expect(tombstoneDigest(USER, PEPPER)).not.toContain('robin');
    expect(tombstoneLocalPart(USER, PEPPER)).not.toContain('@');
  });
});

describe('an anonymised recipient is recognised by shape, not by a lookup', () => {
  const TOMBSTONE = tombstoneAddress(USER, PEPPER, DOMAIN);

  it('recognises the address it mints', () => {
    expect(isAnonymizedRecipient(TOMBSTONE)).toBe(true);
  });

  it('recognises it inside the delimited display-name form the address parser also accepts', () => {
    // A check that only understood the bare form would pass a tombstone addressed
    // as `"Robin" <deleted-…@…>` — and that spelling is legal input to every
    // other check in the send path.
    expect(isAnonymizedRecipient(`"Robin" <${TOMBSTONE}>`)).toBe(true);
    expect(isAnonymizedRecipient(`Robin <${TOMBSTONE}>`)).toBe(true);
  });

  it('recognises it whatever the case of the hex, because no generator emits upper but a client may fold it', () => {
    expect(isAnonymizedRecipient(TOMBSTONE.toUpperCase())).toBe(true);
  });

  it('leaves an ordinary address alone', () => {
    for (const address of [
      'robin@example.test',
      'deleted@example.test',
      'deleted-and-gone@example.test',
      'not-deleted-0123456789abcdef0123456789abcdef@example.test',
      '',
      'no-at-sign',
    ]) {
      expect(isAnonymizedRecipient(address), address).toBe(false);
    }
  });

  it('treats ANY deleted-<32 hex> address as a tombstone, including one this deployment never minted', () => {
    // The shape check has no registry and no pepper, by construction: a tombstone
    // has to stay recognisable after the row it replaced is gone, and after a
    // rotation under a pepper this process no longer holds. The cost is the
    // pathological real address above, and it is a denial rather than a leak.
    expect(isAnonymizedRecipient(`deleted-${'a1b2c3d4'.repeat(4)}@anywhere.example`)).toBe(true);
  });

  it('is not fooled by a prefix on its own or by a wrong-length digest', () => {
    // Both are the near-misses a substring check would wave through, and the first
    // is the one an attacker would actually try: a real address whose local part
    // BEGINS with the marker, so a `startsWith` test refuses an innocent person
    // and passes a padded one.
    expect(isAnonymizedRecipient('deleted-0123456789abcdef0123456789abcde@example.test')).toBe(false);
    expect(isAnonymizedRecipient(`x${TOMBSTONE}`)).toBe(false);
    expect(isAnonymizedRecipient(`deleted-${'0'.repeat(31)}@example.test`)).toBe(false);
  });
});