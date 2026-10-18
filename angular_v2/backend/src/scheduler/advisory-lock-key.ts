import { createHash } from 'node:crypto';

/**
 * The advisory-lock key derivation, in one file and nowhere else.
 *
 * ## Why a lock key is derived at all, rather than written down
 *
 * `pg_try_advisory_lock` takes a number, and the obvious thing is to write the job's
 * name into a constant: `const PURGE_SWEEPER_LOCK = 0x5055_5247`. That number is
 * then a second piece of the job's identity that nobody maintains: rename the job
 * and the lock is still the old one, and the next person to add a job picks the next
 * free-looking constant, which is how two subsystems end up serialising each other
 * by accident. Deriving the key from the name removes the maintenance — the name is
 * the whole input, and a renamed job is a different lock because the rename changed
 * the string it is hashed from.
 *
 * ## The two-int form, and what each half is for
 *
 * `pg_try_advisory_lock(classid, objid)` splits the 64-bit space in two, and this
 * application claims one whole half:
 *
 *   * **`SCHEDULER_LOCK_NAMESPACE` (`classid`) is a constant, forever.** It is ASCII
 *     `SCHD` read big-endian. Any other user of an advisory lock in this database —
 *     a future worker, a `pg_dump` helper, a migration that serialises itself — picks
 *     its own `classid`, so a job in this repository cannot serialise against it and
 *     cannot be serialised by it. **It is not configurable and it is never derived**,
 *     because changing it is not a refactor: a process running the old build and one
 *     running the new build would each hold "the same" job's lock under different
 *     keys, and the single-instance property this unit exists to provide would be
 *     silently gone for exactly as long as the rollout.
 *   * **`schedulerLockKeyFor(jobName)` (`objid`) is derived from the job's name**,
 *     and that half is what keeps one job from blocking another.
 *
 * ## Why sha256, and why the first four bytes
 *
 * `crypto.createHash('sha256')` is in the standard library and is deterministic
 * across processes, machines and Node versions — which is the property the restart
 * case depends on: a job killed mid-run and re-run by another process must reach
 * the SAME key, or the second process takes a lock nobody is holding and both run.
 *
 * A job name is not hashed **in the database** (`hashtext()` would work and was
 * rejected): the derivation has to be readable from the log line and reproducible
 * by anything auditing it, and a database function whose definition can be changed
 * by a migration is not one. The first four bytes read big-endian as a signed
 * 32-bit integer give the full `int4` argument; two job names colliding is a
 * 1-in-2^32 event per pair, and `test/unit/scheduler/advisory-lock-key.spec.ts`
 * asserts that no two shipped jobs collide rather than asking a reader to trust the
 * arithmetic.
 */
export const SCHEDULER_LOCK_NAMESPACE = 0x5343_4844;

/**
 * The string the digest is taken over, prefixed so the key belongs to THIS
 * application and not to whoever else hashes the same job name for some other
 * purpose. Changing it moves every lock this application takes, with exactly the
 * rollout hazard `SCHEDULER_LOCK_NAMESPACE` carries — so it is a constant, and the
 * key derivation test pins one derived value to catch a change nobody intended.
 */
const LOCK_KEY_PREFIX = 'angular_v2.scheduler.job';

/**
 * The `objid` half of the lock key for `jobName`.
 *
 * A job is named by its dispatch token (`purge.sweeper`, `notifications.materialize`),
 * the one vocabulary `BREAKER_PROTECTED`, the breaker gate and the scheduler
 * registry already share — so "the name of the job" has exactly one answer in this
 * codebase and the lock key cannot be derived from a second spelling of it.
 */
export function schedulerLockKeyFor(jobName: string): number {
  return createHash('sha256').update(`${LOCK_KEY_PREFIX}:${jobName}`).digest().readInt32BE(0);
}