/**
 * The `NOTIFICATIONS_*` namespace, read once and asserted at boot.
 *
 * ## Why these three keys HAVE defaults, when the three namespaces beside them do not
 *
 * `retention-environment.ts` draws the line and this namespace sits on the other
 * side of it, deliberately. There, a key decides WHOSE DATA ENDS, so a default
 * nobody chose silently applies and an operator reads one window while the code
 * destroys on another — a published policy and an enforced one that disagree
 * (GDPR Art. 5(1)(e)). Here, every key decides either WHEN a job fires or HOW FAR
 * BACK it looks, and neither of those is a decision about whose data ends:
 *
 *   * the interval asks the question more or less often;
 *   * the overlap decides how much already-known material is re-read, which is
 *     wasted work in the worst case and never wrong work — the write is
 *     `ON CONFLICT DO NOTHING`, so a second read changes nothing;
 *   * the expiry decides how long a *rendering* of a source row stays visible.
 *     Nothing is destroyed by it: `expires_at` hides a row from the panel and the
 *     row itself survives, which is the difference between this and a retention
 *     window in a sentence.
 *
 * So a default is allowed here — and, exactly as in `RETENTION_ENQUEUE_INTERVAL_SECONDS`,
 * **a malformed value is refused at boot naming the key, the value received and the
 * range.** That half is not negotiable and is the reason this file exists at all:
 * `NOTIFICATIONS_LOOKBACK_SECONDS=1h` is a materialiser with an overlap of `NaN`,
 * which would quietly degrade to "no overlap at all", which is precisely the silent
 * backdated-record loss the overlap exists to prevent, and the expiry keys above it
 * would look entirely configured.
 *
 * ## Why this is a second loader and not a field of `Environment`
 *
 * `breaker-environment.ts` gives the argument and `retention-environment.ts` repeats
 * it: `Environment` is asserted key-for-key by `test/unit/environment.spec.ts`, a
 * suite this change does not own, and one namespace one loader is the rule the two
 * existing loaders established. An operator reading `NOTIFICATIONS_LOOKBACK_SECONDS`
 * is not sent looking for the notification overlap two files away.
 *
 * ## The floors, and why they are the ceilings that matter
 *
 * The floors are `1`, not `0`. `readCount`-shaped helpers in this repository reject
 * zero because a zero here is not "no overlap" and "expire immediately" — it is a
 * key that silently removes the mechanism it configures, which is `JWT_SECRET`'s
 * default in a different costume (§2.3).
 */

/** Seconds between two materialisation passes. Five minutes by default. */
export const DEFAULT_MATERIALIZE_INTERVAL_SECONDS = 300;

/**
 * One hour of overlap by default.
 *
 * Sized against the interval rather than picked: the window has to comfortably
 * exceed the worst gap between two successful runs (a deploy, a crash, a machine
 * asleep overnight) or the overlap is decoration. One hour against a five-minute
 * interval absorbs twelve consecutive missed runs and is short enough that a
 * re-read stays trivial next to the write it protects.
 */
export const DEFAULT_LOOKBACK_SECONDS = 3600;

/** Thirty days, matching what an operator would call "recent". */
export const DEFAULT_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

/**
 * A year, as a ceiling on all three.
 *
 * Past a year the value is far more likely to be a units mistake — milliseconds, or
 * seconds typed into a key that wanted hours — than a schedule anybody wants. This
 * is the same reasoning `MAXIMUM_ENQUEUE_INTERVAL_SECONDS` records, and the reason
 * the number is a bound rather than taste.
 */
export const MAXIMUM_SECONDS = 365 * 24 * 60 * 60;

export type NotificationEnvironment = {
  /** How often `notifications.materialize` fires. Seconds, HAS a default. */
  readonly materializeIntervalSeconds: number;
  /**
   * How far BEHIND the watermark each pass still reads, and how far back the very
   * first pass starts. Seconds, HAS a default.
   *
   * One number for both, because they are one number: the first pass has no
   * watermark, so "start from the beginning of what is in scope" is the overlap
   * applied to a watermark of *now*. A first run then materialises one window's
   * worth rather than the whole table, which is the difference between a deploy
   * taking a second and taking an hour.
   */
  readonly lookbackSeconds: number;
  /** How long a materialised notification stays visible. Seconds, HAS a default. */
  readonly expirySeconds: number;
};

/**
 * The DI token for the validated namespace.
 *
 * A `NotificationEnvironment` is a plain object, so it cannot be its own injection
 * token; the token and the value are created together in `notifications.module.ts`,
 * so nothing can register one without the other.
 */
export const NOTIFICATIONS_ENV = 'NOTIFICATIONS_ENVIRONMENT';

export class NotificationEnvironmentError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `The notification configuration is not usable. ${String(problems.length)} problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
    this.name = 'NotificationEnvironmentError';
    this.problems = problems;
  }
}

/**
 * One integer, with a default, refused when malformed.
 *
 * The refusal names the key, the value received and the range — the three things an
 * operator needs and the three things a bare "invalid configuration" withholds.
 * `what` says what the number decides, because `NOTIFICATIONS_LOOKBACK_SECONDS=60`
 * and `NOTIFICATIONS_EXPIRY_SECONDS=60` are both valid and mean opposite things.
 */
function readSeconds(
  source: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
  what: string,
  problems: string[],
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
      `${key} must be a whole number of seconds, received '${text}'. It is ${what}, and a value ` +
        'nobody can parse is a materialiser running with a window that does not exist.',
    );
    return undefined;
  }
  const value = Number.parseInt(text, 10);
  if (value < 1 || value > MAXIMUM_SECONDS) {
    problems.push(
      `${key} must be between 1 and ${String(MAXIMUM_SECONDS)} seconds, received ${String(value)} — ` +
        `${what}, and past a year the value is far more likely to be a units mistake than a schedule. ` +
        'Zero is refused too: it does not mean "no overlap" or "never expires", it means the mechanism ' +
        'is silently switched off.',
    );
    return undefined;
  }
  return value;
}

export function loadNotificationEnvironment(
  source: Readonly<Record<string, unknown>>,
): NotificationEnvironment {
  const problems: string[] = [];

  const materializeIntervalSeconds = readSeconds(
    source,
    'NOTIFICATIONS_MATERIALIZE_INTERVAL_SECONDS',
    DEFAULT_MATERIALIZE_INTERVAL_SECONDS,
    'how often the materialiser asks its sources for anything new',
    problems,
  );
  const lookbackSeconds = readSeconds(
    source,
    'NOTIFICATIONS_LOOKBACK_SECONDS',
    DEFAULT_LOOKBACK_SECONDS,
    'how far behind the watermark each pass still reads',
    problems,
  );
  const expirySeconds = readSeconds(
    source,
    'NOTIFICATIONS_EXPIRY_SECONDS',
    DEFAULT_EXPIRY_SECONDS,
    'how long a materialised notification stays visible',
    problems,
  );

  // All three are checked before any is acted on, and every problem is reported in
  // one error: a boot that names one of three bad keys sends the operator round the
  // loop twice more (`loadEnvironment`, `loadRetentionEnvironment`).
  if (
    materializeIntervalSeconds === undefined ||
    lookbackSeconds === undefined ||
    expirySeconds === undefined
  ) {
    throw new NotificationEnvironmentError(problems);
  }
  return { materializeIntervalSeconds, lookbackSeconds, expirySeconds };
}