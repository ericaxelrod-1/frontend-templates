/**
 * The `RETENTION_*` windows, read once and asserted at boot.
 *
 * ## Why this is a decision and not a scheduling fact, which is why it has no default
 *
 * `breaker-environment.ts:19-24` draws the line this file sits on: an *operational*
 * key (`PURGE_POLL_SECONDS`, `PURGE_DRAIN_BUDGET`, `RETENTION_PURGE_MAX_ATTEMPTS`)
 * carries a documented default because it changes WHEN a job runs, while every key
 * that decides whether the process stops working, and every key that decides
 * whether personal data is destroyed, is required and has none.
 *
 * Each key here is the predicate in an `authz.retention_due_*()` function that
 * decides which users' rows are permanently deleted. A default nobody chose
 * silently applies — `0011` records the whole harm of a retention policy that is
 * published and not enforced, in GDPR Art. 5(1)(e) and CPRA §1798.100(a)(3)
 * terms: an operator reads the configured window, and the code deletes on
 * another one.
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
 *
 * ## Two keys, because the two populations have genuinely different clocks
 *
 * `RETENTION_TOMBSTONE_DAYS` ages a **tombstone**: a row whose erasure has
 * already been recorded, where the person is gone. `RETENTION_INACTIVE_ACCOUNT_DAYS`
 * ages a **live account** whose last OBSERVED activity is old. They are not one
 * window because they answer different questions and carry different stakes:
 *
 *   * a tombstone's clock starts at the erasure, and §9A.6's first anchor exists
 *     because a clock that restarts on every touch is retention that never
 *     expires;
 *   * a live account's clock starts at its last observation, and destroying one
 *     destroys a working account — so its floor is stated separately rather than
 *     inherited from the tombstone's.
 *
 * One key for both would be a single number deciding two unrelated questions,
 * which is the shape of a knob nobody can reason about: lowering it for the
 * tombstone population would silently accelerate the destruction of live
 * accounts, and no operator reading the key name could tell that had happened.
 *
 * ## …and ONE key here IS a scheduling fact, so it has a default
 *
 * `RETENTION_ENQUEUE_INTERVAL_SECONDS` is the interval the scan runs on, and the
 * line `breaker-environment.ts:19-24` draws is exactly the line this key sits on: the
 * two windows decide WHOSE DATA ENDS, and an interval decides only WHEN the question
 * is asked. A default is therefore allowed here and refused for the windows — and it
 * is still **refused when malformed**, naming the key, because "hourly" in a
 * `.env` file is a process that boots with a scan that never runs and nothing that
 * says so (§2.3). The default is 3600, which is what the constant it replaced said.
 *
 * It is here rather than in `breaker-environment.ts` with `PURGE_POLL_SECONDS`
 * because it belongs to the `RETENTION_*` namespace an operator reads for the rest
 * of retention, and one namespace one loader is the rule the two existing loaders
 * established. What it does NOT do is decide dispatch, which is what keeps it from
 * being a breaker key.
 */
export type RetentionEnvironment = {
  /**
   * How long a soft-deleted user is kept before the retention scan will enqueue
   * their row for deletion. Days, and it is required.
   */
  readonly tombstoneDays: number;
  /**
   * How long a LIVE account may go with no observed activity before the retention
   * scan will enqueue their row for deletion. Days, and it is required.
   *
   * Only accounts with a recorded `users.last_activity_at` are considered at all
   * (`0017` §1): an account whose activity was never observed is not dormant, it
   * is unmeasured, and it is not eligible for destruction.
   */
  readonly inactiveAccountDays: number;
  /**
   * How often the enqueue scan runs. Seconds, and it HAS a default — see
   * {@link DEFAULT_ENQUEUE_INTERVAL_SECONDS} for why this key is on the other side
   * of the line the two windows are on.
   */
  readonly enqueueIntervalSeconds: number;
};

/**
 * The DI token for the validated windows.
 *
 * A `RetentionEnvironment` is a plain object, so it cannot be its own injection
 * token; the token and the value are created together in `purge.module.ts`, so
 * nothing can register one without the other.
 */
export const RETENTION_ENV = 'RETENTION_ENVIRONMENT';

/**
 * THE BOUNDS, and they are the same four numbers the database enforces.
 *
 * `authz.retention_due_tombstones()` refuses anything outside 1825..36500 with
 * `22023` and `authz.retention_due_accounts()` refuses anything outside
 * 1095..36500, and this loader refuses the same two ranges before the process can
 * reach either. Two copies of one bound would be two answers to "is 1 valid"
 * (§2.4), so the numbers are stated here and repeated there deliberately: the
 * application refuses a misconfiguration at boot, and the function refuses a
 * malformed call from anywhere else — which is a different caller with a
 * different reason to lie. **A boot check covers one process; the function is
 * reachable by anything granted `EXECUTE`.**
 *
 * ## 1825 — five years, for tombstones, and the floor is the point
 *
 * This number was `1` until `0017`. `0016` bounded the key at `1..36500`, which
 * caught `0` and `-1` and let `1` through — and `1` is the single most damaging
 * value in the range: **set `RETENTION_TOMBSTONE_DAYS=1` and every tombstone in
 * the repository is hard-destroyed on the next sweep.** That is the failure
 * `0011:222-228` names: the template publishes a five-year retention policy and
 * a misconfiguration destroys on another one. A lower bound of 1 is a bound on
 * syntax, not on harm.
 *
 * `docs/rebase.md` §9A.4 tabulated this row as *1825 days, a floor* and §9A.6
 * records the decision (2026-10-12); the floor is now the number in force.
 *
 * ## 1095 — three years, for live accounts, and why it is not 1825
 *
 * A dormant account is a person who is merely quiet, and no law sets their
 * window; three years is the shortest defensible one for destroying a working
 * account. It is lower than the tombstone floor because the two populations carry
 * different evidence — a tombstone is a recorded erasure and `0011`'s compliance
 * argument requires its record to survive, while a live account has asserted
 * nothing about itself and is judged on inactivity alone. Stated separately rather
 * than inherited, so the two numbers cannot be changed as one.
 *
 * ## 36500 — a century, for both
 *
 * Past this point the value is not a retention policy anybody reads as one, and
 * the number is far more likely to be a units mistake (milliseconds, seconds)
 * than a decision.
 */
export const MINIMUM_TOMBSTONE_DAYS = 1825;
export const MAXIMUM_TOMBSTONE_DAYS = 36500;
export const MINIMUM_INACTIVE_ACCOUNT_DAYS = 1095;
export const MAXIMUM_INACTIVE_ACCOUNT_DAYS = 36500;

/**
 * An hour, which is what the constant this key replaced said. The scan is a
 * window comparison measured in DAYS, so an hourly cadence is already two orders of
 * magnitude finer than the thing it measures — the number is small enough that
 * nobody tunes it, and the key exists so that *changing* it is a configuration
 * decision somebody made rather than an edit to a source file somebody forgot.
 */
export const DEFAULT_ENQUEUE_INTERVAL_SECONDS = 3600;

/**
 * A year, as a ceiling, and for the reason `MAXIMUM_TOMBSTONE_DAYS` exists: past
 * this point the value is far more likely to be a units mistake — milliseconds, or
 * seconds typed into a key that wanted days — than a schedule anybody wants.
 */
export const MAXIMUM_ENQUEUE_INTERVAL_SECONDS = 365 * 24 * 60 * 60;

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

/** What each key decides, so the refusal message says what the number was for. */
type RetentionKey = {
  readonly key: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly subject: string;
  /** True when the floor is a floor (an error) rather than a syntax bound. */
  readonly floor: string;
};

const RETENTION_KEYS: readonly RetentionKey[] = [
  {
    key: 'RETENTION_TOMBSTONE_DAYS',
    minimum: MINIMUM_TOMBSTONE_DAYS,
    maximum: MAXIMUM_TOMBSTONE_DAYS,
    subject: 'a soft-deleted user — a tombstone whose erasure is already recorded',
    floor:
      'below the floor it is not the five-year retention policy this template publishes, and a ' +
      'window of 1 hard-destroys every tombstone in the repository on the next sweep',
  },
  {
    key: 'RETENTION_INACTIVE_ACCOUNT_DAYS',
    minimum: MINIMUM_INACTIVE_ACCOUNT_DAYS,
    maximum: MAXIMUM_INACTIVE_ACCOUNT_DAYS,
    subject: 'a live account whose last observed activity is older than the window',
    floor:
      'below the floor it is not a three-year window, and a window of 1 would hard-destroy ' +
      "every account with an observed login within three years of now() on the next sweep",
  },
] as const;

/**
 * The specification for a key, looked up by its own name.
 *
 * A missing name is a programming error in this file rather than a configuration
 * the operator could cause, and it throws rather than returning `undefined`: an
 * undefined specification would reach `readRequiredDays` and be dereferenced there,
 * which is a `TypeError` three frames from the mistake.
 */
function byKey(key: string): RetentionKey {
  const specification = RETENTION_KEYS.find((candidate) => candidate.key === key);
  if (specification === undefined) {
    throw new Error(
      `retention-environment.ts: no specification is declared for ${key}. Every key this loader ` +
        'validates must have a floor, a ceiling and a subject — a key validated without them is a key ' +
        'nobody can reason about.',
    );
  }
  return specification;
}

/**
 * One required integer, and no fallback.
 *
 * `readInteger` in `breaker-environment.ts` is deliberately not reused: it is not
 * exported, and importing it would put a retention decision behind a breaker
 * loader's name. The shape is the same one line of validation either way, and the
 * duplication is two dozen lines rather than a rule.
 *
 * **The refusal names the key, the value received and the floor**, because a boot
 * failure that names none of the three is a boot failure an operator cannot act
 * on: the difference between "RETENTION_TOMBSTONE_DAYS=30" and "RETENTION_TOMBSTONE_DAYS=1825"
 * is the difference between deleting every tombstone in the repository and the
 * policy this template documents.
 */
function readRequiredDays(
  source: Readonly<Record<string, unknown>>,
  specification: RetentionKey,
  problems: string[],
): number | undefined {
  const { key } = specification;
  const raw = source[key];

  if (raw === undefined || raw === null || raw === '') {
    problems.push(
      `${key} is required but was not set. It is the window after which ${specification.subject} is ` +
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
  if (value < specification.minimum || value > specification.maximum) {
    problems.push(
      `${key} must be between ${String(specification.minimum)} and ${String(specification.maximum)} days, ` +
        `received ${String(value)} — ${specification.floor}.`,
    );
    return undefined;
  }
  return value;
}

/**
 * One interval, with a default — the other half of the namespace's rule.
 *
 * Absent means the documented default and nothing else. Present but malformed is a
 * boot failure naming the key, the value received and the range, because the failure
 * this guards against is not "the wrong cadence" — an hourly scan is fine — it is a
 * scan that never runs because a value like `1h` became `NaN`, silently, with the
 * retention windows above them looking entirely configured.
 */
function readIntervalSeconds(
  source: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
  fallback: number,
): number | undefined {
  const raw = source[key];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    problems.push(`${key} must be an integer number of seconds, received ${typeof raw}`);
    return undefined;
  }
  const text = String(raw);
  if (!/^\d+$/.test(text)) {
    problems.push(
      `${key} must be a whole number of seconds, received '${text}'. A scan interval nobody can ` +
        'parse is a retention sweep that never runs, reported by no log line.',
    );
    return undefined;
  }
  const value = Number.parseInt(text, 10);
  if (value < 1 || value > MAXIMUM_ENQUEUE_INTERVAL_SECONDS) {
    problems.push(
      `${key} must be between 1 and ${String(MAXIMUM_ENQUEUE_INTERVAL_SECONDS)} seconds, received ` +
        `${String(value)} — past a year the value is far more likely to be a units mistake than a schedule.`,
    );
    return undefined;
  }
  return value;
}

export function loadRetentionEnvironment(source: Readonly<Record<string, unknown>>): RetentionEnvironment {
  const problems: string[] = [];
  const read = (specification: RetentionKey): number | undefined =>
    readRequiredDays(source, specification, problems);

  // Read by name rather than by index into `RETENTION_KEYS`, because a tuple index
  // here is an anonymous coupling: adding a third key silently leaves the third one
  // unread and the loader accepts a source that never supplied it. Two named reads
  // and two named returns is the whole of the enforcement, and it is what makes
  // "required in every mode" a property this function can actually have.
  const tombstoneDays = read(byKey('RETENTION_TOMBSTONE_DAYS'));
  const inactiveAccountDays = read(byKey('RETENTION_INACTIVE_ACCOUNT_DAYS'));
  // …and the one key with a default, read through the loader like the other two
  // rather than by the job reaching for the environment itself.
  const enqueueIntervalSeconds = readIntervalSeconds(
    source,
    'RETENTION_ENQUEUE_INTERVAL_SECONDS',
    problems,
    DEFAULT_ENQUEUE_INTERVAL_SECONDS,
  );

  // All three are checked before any is acted on, and every problem is reported in
  // one error — a boot that names only the first of two bad keys sends the
  // operator round the loop a second time to discover the second.
  if (tombstoneDays === undefined || inactiveAccountDays === undefined || enqueueIntervalSeconds === undefined) {
    throw new RetentionEnvironmentError(problems);
  }
  return { tombstoneDays, inactiveAccountDays, enqueueIntervalSeconds };
}