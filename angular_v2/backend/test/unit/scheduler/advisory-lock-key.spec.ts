import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KNOWN_DISPATCH_TOKENS } from '../../../src/breaker/dispatch-token.js';
import { SCHEDULER_LOCK_NAMESPACE, schedulerLockKeyFor } from '../../../src/scheduler/advisory-lock-key.js';

/**
 * The lock KEY, proven to be the two things it has to be.
 *
 * A lock key that is not stable across processes is not a lock: a job killed
 * mid-run and restarted would take a *different* key, find it free, and run beside
 * whatever is still holding the old one — the single-instance property this unit
 * exists for, gone silently. A key that is not distinct per job is a lock on the
 * wrong thing: two unrelated jobs take turns, and neither of them says why.
 *
 * So both are asserted here, and neither is left to the arithmetic. This file needs
 * no database: the claim under test is about the DERIVATION, and the behaviour of
 * the key Postgres is handed is proved with a real connection in
 * `job-runner.spec.ts`.
 */
describe('the advisory lock key is derived from the job name, not written down', () => {
  it('is one constant namespace for this application, so it cannot collide with another lock user', () => {
    // The `classid` half is ASCII `SCHD`. It is a constant because it is a CLAIM on a
    // namespace: any other user of an advisory lock in this database picks its own
    // `classid`, so a job here cannot serialise against one and cannot be serialised
    // by one. It is in range for the `int4` Postgres is handed, because a value past
    // 2^31 is refused by the parameter type — at run time, on the first job, in
    // production.
    expect(SCHEDULER_LOCK_NAMESPACE).toBe(0x5343_4844);
    expect(Number.isInteger(SCHEDULER_LOCK_NAMESPACE)).toBe(true);
    expect(SCHEDULER_LOCK_NAMESPACE).toBeGreaterThan(-(2 ** 31));
    expect(SCHEDULER_LOCK_NAMESPACE).toBeLessThan(2 ** 31);
  });

  it('is the same value every time it is asked for, which is what a restart depends on', () => {
    // The same call, twice, in one process. A per-process salt — a pid, a random
    // nonce, `Math.random()` — would pass this and fail in the only case that
    // matters, which is a second PROCESS asking.
    expect(schedulerLockKeyFor('purge.sweeper')).toBe(schedulerLockKeyFor('purge.sweeper'));

    // …and the pinned literal, because the derivation is a CONTRACT. Changing the
    // prefix moves every lock this application takes, and a rollout that straddles
    // the change is two instances that do not exclude each other for exactly as long
    // as the old build is still alive. That is not a refactor; it is a silent loss of
    // the guarantee, so it has to be a deliberate edit of this line.
    expect(schedulerLockKeyFor('purge.sweeper')).toBe(-1870131873);
  });

  it('is a signed 32-bit integer for every shipped job, and no two of them collide', () => {
    // `readInt32BE` is what produces the `int4`; a future change to `readUInt32BE`
    // would answer above 2^31 and Postgres would refuse the parameter. The range is
    // asserted over the whole vocabulary rather than for one name, so a job added
    // later is covered without editing this file.
    for (const token of KNOWN_DISPATCH_TOKENS) {
      const key = schedulerLockKeyFor(token);
      expect(Number.isInteger(key), `${token} does not derive an integer`).toBe(true);
      expect(key, `${token} derives a value outside int4`).toBeGreaterThanOrEqual(-(2 ** 31));
      expect(key, `${token} derives a value outside int4`).toBeLessThan(2 ** 31);
    }

    const derived = KNOWN_DISPATCH_TOKENS.map((token) => schedulerLockKeyFor(token));
    expect(new Set(derived).size, 'two shipped jobs derive the same lock key').toBe(KNOWN_DISPATCH_TOKENS.length);
  });

  it('hashes a NAMESPACED string, so the same job name in another application is a different lock', () => {
    // The prefix is what makes the key this application's. Proved rather than
    // assumed: a derivation without one is still a working lock, and the collision it
    // leaves is with something nobody in this repository can see.
    const unprefixed = createHash('sha256').update('purge.sweeper').digest().readInt32BE(0);
    expect(schedulerLockKeyFor('purge.sweeper')).not.toBe(unprefixed);
  });

  it('separates two names that differ only in a trailing space, because a lock is not a trim', () => {
    // A typo in a job name is the failure this catches, and the interesting direction
    // is the one where the typo creates a SECOND lock: the same job under two names
    // runs twice, which is the entire defect the lock exists to prevent.
    expect(schedulerLockKeyFor('purge.sweeper')).not.toBe(schedulerLockKeyFor('purge.sweeper '));
  });
});