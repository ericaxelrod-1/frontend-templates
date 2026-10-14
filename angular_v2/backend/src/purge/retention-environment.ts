/**
 * The `RETENTION_*` window, read once and asserted at boot.
 *
 * ## Why this is a decision and not a scheduling fact, which is why it has no default
 *
 * `breaker-environment.ts:19-24` draws the line this file sits on: an *operational*
 * key (`PURGE_POLL_SECONDS`, `PURGE_DRAIN_BUDGET`, `RETENTION_PURGE_MAX_ATTEMPTS`)
 * carries a documented default because it changes WHEN a job runs, while every key
 * that decides whether the process stops working, and every key that decides
 * whether personal data is destroyed, is required and has none.
 *
 * `RETENTION_TOMBSTONE_DAYS` is the second kind and not the first, and the reason
 * is not tidiness. This value is the predicate in `authz.retention_due_tombstones()`
 * that decides which users' rows are permanently deleted. A default nobody chose
 * silently applies — `0011` records the whole harm of a retention policy that is
 * published and not enforced, in GDPR Art. 5(1)(e) and CPRA §1798.100(a)(3) terms:
 * an operator reads the configured window, and the code deletes on another one.
 *
 * **So there is no fallback here, in any mode, and a missing key aborts the boot.**
 * That is the same treatment `JWT_SECRET` gets (§2.3), for the same reason: a
 * control whose value proposition is refusing bad configuration must refuse it
 * before it has acted on it.
 *
 * ## Why this is a second loader and not a field of `BreakerEnvironment`
 *
 * It is not a breaker threshold and it does not decide dispatch, so it does not
 * belong in the `BREAKER_*` namespace whose loader lives in `src/breaker/` and
 * whose shape is asserted key-for-key by a suite this change does not own. One
 * decision, one loader, one name for the namespace — and a forker reading
 * `BREAKER_MEMORY_GREEN` is not left looking for the retention window two files
 * away.
 */
export type RetentionEnvironment = {
  /**
   * How long a soft-deleted user is kept before the retention scan will enqueue
   * their row for deletion. Days, and it is required.
   */
  readonly tombstoneDays: number;
};

/**
 * The DI token for the validated window.
 *
 * A `RetentionEnvironment` is a plain object, so it cannot be its own injection
 * token; the token and the value are created together in `purge.module.ts`, so
 * nothing can register one without the other.
 */
export const RETENTION_ENV = 'RETENTION_ENVIRONMENT';

/**
 * THE BOUNDS, and they are the same two numbers the database enforces.
 *
 * `authz.retention_due_tombstones()` refuses anything outside 1..36500 with
 * `22023`, and this loader refuses the same range before the process can reach it.
 * Two copies of one bound would be two answers to "is 0 valid" (§2.4), so the
 * numbers are stated here and repeated there deliberately: the application refuses
 * a misconfiguration at boot, and the function refuses a malformed call from
 * anywhere else — which is a different caller with a different reason to lie.
 *
 *   0       every tombstone that has ever existed is due for deletion on the next
 *           sweep. Not a slow purge — an immediate one, discovered later.
 *   36500   a century. Past this point the value is not a retention policy anybody
 *           reads as one, and the number is far more likely to be a units mistake
 *           (milliseconds, seconds) than a decision.
 */
export const MINIMUM_TOMBSTONE_DAYS = 1;
export const MAXIMUM_TOMBSTONE_DAYS = 36500;

export class RetentionEnvironmentError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `The retention configuration is not usable. ${problems.length} problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
    this.name = 'RetentionEnvironmentError';
    this.problems = problems;
  }
}

/**
 * One required integer, and no fallback.
 *
 * `readInteger` in `breaker-environment.ts` is deliberately not reused: it is not
 * exported, and importing it would put a retention decision behind a breaker
 * loader's name. The shape is the same one line of validation either way, and the
 * duplication is two dozen lines rather than a rule.
 */
function readRequiredDays(
  source: Readonly<Record<string, unknown>>,
  problems: string[],
): number | undefined {
  const key = 'RETENTION_TOMBSTONE_DAYS';
  const raw = source[key];

  if (raw === undefined || raw === null || raw === '') {
    problems.push(
      `${key} is required but was not set. It is the window after which a soft-deleted user's row is ` +
        'purged, it destroys personal data, and no default may be substituted for a decision nobody made.',
    );
    return undefined;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    problems.push(`${key} must be an integer number of days, received ${typeof raw}`);
    return undefined;
  }
  const text = String(raw);
  if (!/^\d+$/.test(text)) {
    problems.push(
      `${key} must be a whole number of days, received '${text}'. A negative or fractional window ` +
        'is not a retention policy; a value in seconds or milliseconds is a units mistake that would delete early.',
    );
    return undefined;
  }
  const value = Number.parseInt(text, 10);
  if (value < MINIMUM_TOMBSTONE_DAYS || value > MAXIMUM_TOMBSTONE_DAYS) {
    problems.push(
      `${key} must be between ${MINIMUM_TOMBSTONE_DAYS} and ${MAXIMUM_TOMBSTONE_DAYS} days, received ${value}` +
        (value === 0
          ? '. Zero would make every tombstone that has ever existed due for deletion on the next sweep.'
          : ''),
    );
    return undefined;
  }
  return value;
}

export function loadRetentionEnvironment(source: Readonly<Record<string, unknown>>): RetentionEnvironment {
  const problems: string[] = [];
  const tombstoneDays = readRequiredDays(source, problems);
  if (tombstoneDays === undefined) {
    throw new RetentionEnvironmentError(problems);
  }
  return { tombstoneDays };
}
