import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../../../src/auth/uuidv7.js';

const CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('uuidv7 produces the value RFC 9562 version 7 describes', () => {
  it('writes the canonical 8-4-4-4-12 form in lower-case hex', () => {
    expect(uuidv7()).toMatch(CANONICAL);
  });

  it('sets the version nibble to 7, so the value is a v7 and not the v4 it was derived from', () => {
    // The 13th hex digit is the version nibble. `randomUUID()` leaves 4 there, and
    // the derivation has to overwrite it — a v4 that merely looks time-ordered is
    // still a v4, and still random for a reader who trusts the version.
    const thirteenth = uuidv7().charAt(14);
    expect(thirteenth).toBe('7');
  });

  it('sets the variant bits to 0b10, because a wrong variant makes the value invalid rather than merely unusual', () => {
    // The 17th hex digit carries the two variant bits in its high pair: 8, 9, a, b.
    const seventeenth = uuidv7().charAt(19);
    expect(['8', '9', 'a', 'b']).toContain(seventeenth);
  });

  it('puts the given timestamp in the leading 48 bits, so ids sort by minting time', () => {
    const timestampMs = 1_700_000_000_123;
    const hex = timestampMs.toString(16).padStart(12, '0');
    // The 12 leading hex digits straddle the canonical hyphen, so the expected
    // prefix has to carry it too or the comparison is against the wrong string.
    const expectedPrefix = `${hex.slice(0, 8)}-${hex.slice(8, 12)}`;
    expect(uuidv7(timestampMs).startsWith(expectedPrefix)).toBe(true);
  });

  it('orders two ids minted a second apart, which is the reason for choosing v7 over v4', () => {
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_001_000);
    expect(earlier < later).toBe(true);
  });
});

describe('the parts that are not the timestamp', () => {
  it('still randomises the low bits within a single millisecond, so two ids minted together differ', () => {
    // Fixed timestamp isolates the tail: any collision here is a derivation that
    // zeroes the randomness instead of shuffling it.
    const timestampMs = 1_700_000_000_000;
    const minted = new Set<string>();
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      minted.add(uuidv7(timestampMs));
    }
    expect(minted.size).toBe(1000);
  });

  it('does not collide over 10,000 consecutive calls, so the low bits carry uniqueness', () => {
    const minted = new Set<string>();
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      minted.add(uuidv7());
    }
    expect(minted.size).toBe(10_000);
  });

  it('stays a version 7 at both ends of the timestamp range, rather than only at today’s', () => {
    // Zero and the far future are where a truncation or overflow bug would show.
    expect(uuidv7(0).charAt(14)).toBe('7');
    expect(uuidv7(2 ** 48 - 1).charAt(14)).toBe('7');
    expect(uuidv7(2 ** 48 - 1)).toMatch(CANONICAL);
  });

  it('writes the timestamp back out exactly at both ends of the range, so the guard did not narrow it', () => {
    // A range check that rejected the valid ends would look identical to one that
    // rejects only the invalid ones, so the value itself is read back: `0` must be
    // twelve zero hex digits and the ceiling minus one must be twelve `f`s.
    expect(uuidv7(0).startsWith('00000000-0000-')).toBe(true);
    expect(uuidv7(2 ** 48 - 1).startsWith('ffffffff-ffff-')).toBe(true);
  });
});

describe('a timestamp the 48-bit field cannot hold is refused, not truncated', () => {
  // The write is `remaining % 256` six times, which is silent arithmetic. Both of
  // these used to return a well-formed v7 carrying the wrong time, which is worse
  // than throwing: the time prefix is the whole reason this generator exists, and a
  // zeroed one breaks the ordering with nothing anywhere reporting an error
  // (`AGENTS.md` §2.3). `Date.now()` cannot produce either value, so this guards the
  // public parameter rather than the caller.

  it('refuses 2^48, because the loop wraps it to a timestamp of 0 and the id then sorts as if minted in 1970', () => {
    // Before the guard: `00000000-0000-7…` — a valid-looking v7 whose leading 48
    // bits were zero, indistinguishable from `uuidv7(0)`.
    expect(() => uuidv7(2 ** 48)).toThrow(RangeError);
    expect(() => uuidv7(2 ** 48)).toThrow(/safe integer in \[0, 2\^48\)/);
  });

  it('refuses a negative timestamp, which `%` turns into a head of all ffs — a time in the year 10889', () => {
    // Before the guard: `ffffffff-ffff-7…`, a timestamp larger than the field's
    // ceiling and later than any row it could be compared against.
    expect(() => uuidv7(-1)).toThrow(RangeError);
    expect(() => uuidv7(-1)).toThrow(/safe integer in \[0, 2\^48\)/);
  });

  it('refuses a non-integer, which `%` floors to a millisecond nobody asked for', () => {
    // `1.5` used to mint the id for `1`.
    expect(() => uuidv7(1.5)).toThrow(RangeError);
  });

  it('refuses NaN and Infinity, which both `%` reduce to a zeroed head', () => {
    // `NaN % 256` is NaN, and `bytes[index] = NaN` stores 0 — so the timestamp came
    // out as zero with no error anywhere.
    expect(() => uuidv7(Number.NaN)).toThrow(RangeError);
    expect(() => uuidv7(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => uuidv7(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });

  it('names the offending value in the message, so the caller can see which one it passed', () => {
    expect(() => uuidv7(2 ** 48)).toThrow(/281474976710656/);
    expect(() => uuidv7(-1)).toThrow(/-1/);
  });

  it('does not return a value at all, because a wrong id that looks right is the failure', () => {
    let produced: string | undefined;
    try {
      produced = uuidv7(2 ** 48);
    } catch {
      produced = undefined;
    }
    expect(produced).toBeUndefined();
  });

  it('still mints one for the default argument, so the only production caller is unaffected', () => {
    expect(uuidv7()).toMatch(CANONICAL);
    expect(Number.isNaN(Number.parseInt(uuidv7().slice(0, 8), 16))).toBe(false);
  });
});