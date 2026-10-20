/**
 * The `SECURITY_TELEMETRY_*` namespace, read once and asserted at boot.
 *
 * ## WHY THIS IS A SEPARATE LOADER AND NOT A FIELD OF `Environment`
 *
 * `breaker-environment.ts` and `retention-environment.ts` draw the same line and
 * `notification-environment.ts` states it: `Environment` is asserted key-for-key by
 * `test/unit/environment.spec.ts`, a suite this feature does not own, and one
 * namespace one loader is the rule the three existing loaders established. An
 * operator reading `SECURITY_TELEMETRY_ALERT_THRESHOLD` is not sent looking for
 * the alert threshold in a file about database coordinates.
 *
 * ## WHY EVERY KEY HERE HAS A DEFAULT
 *
 * The same line `notification-environment.ts` draws, on the same grounds: every key
 * below decides either WHEN a job fires, HOW WIDE a window is, or HOW BAD a score
 * has to be before it is called bad. **None of them decides whose data ends**, and
 * none of them decides whether a request is refused. The last one matters more
 * here than anywhere else in the tree, because §B6 says behavioural and risk
 * scoring is TRIAGE and never prevention — so the numbers below choose what an
 * operator is shown, never what a caller is denied.
 *
 * A MALFORMED value is still refused at boot, naming the key, the value and the
 * range. `SECURITY_TELEMETRY_ALERT_THRESHOLD=ten` is a telemetry pipeline that
 * never raises an alert, and it would look entirely configured.
 */

/** How long one pattern's window is open, in seconds. */
export const DEFAULT_TELEMETRY_WINDOW_SECONDS = 900;

/**
 * How many matching requests inside one window raise an alert.
 *
 * Five is the number the brute-force block threshold uses for a different
 * decision, and this one is deliberately larger: the block refuses a request and
 * this one only tells a human, so it may be noisier without being harmful.
 */
export const DEFAULT_TELEMETRY_ALERT_THRESHOLD = 10;

/** How often the flush job fires, in seconds. */
export const DEFAULT_TELEMETRY_FLUSH_SECONDS = 60;

/** The score a host starts at, and the ceiling of the scale. */
export const DEFAULT_TELEMETRY_REPUTATION_BASE_SCORE = 100;

/** How much one observed failure or one observed pattern costs the host. */
export const DEFAULT_TELEMETRY_REPUTATION_PENALTY = 10;

/** Below this score a host is `suspicious`. */
export const DEFAULT_TELEMETRY_REPUTATION_SUSPICIOUS_SCORE = 80;

/** Below this score a host is `bad`. */
export const DEFAULT_TELEMETRY_REPUTATION_BAD_SCORE = 40;

/**
 * A year, as a ceiling on the window and on the intervals.
 *
 * Past a year the value is far more likely to be a units mistake — milliseconds,
 * or seconds typed into a key that wanted hours — than a schedule anybody wants.
 */
export const MAXIMUM_TELEMETRY_SECONDS = 365 * 24 * 60 * 60;

export type TelemetryEnvironment = {
  /** How long a pattern's window stays open. Seconds. */
  readonly windowSeconds: number;
  /** Matching requests inside one window that raise an alert. */
  readonly alertThreshold: number;
  /** How often the flush job fires. Seconds. */
  readonly flushSeconds: number;
  /** The score a host starts at, and the ceiling of the scale. */
  readonly reputationBaseScore: number;
  /** What one observed failure or pattern costs a host. */
  readonly reputationPenalty: number;
  /** Below this score a host is `suspicious`. */
  readonly reputationSuspiciousScore: number;
  /** Below this score a host is `bad`. */
  readonly reputationBadScore: number;
};

/**
 * The DI token for the validated namespace.
 *
 * A `TelemetryEnvironment` is a plain object, so it cannot be its own injection
 * token; the token and the value are created together in `security.module.ts`, so
 * nothing can register one without the other.
 */
export const TELEMETRY_ENV = 'SECURITY_TELEMETRY_ENVIRONMENT';

export class TelemetryEnvironmentError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `The security-telemetry configuration is not usable. ${String(problems.length)} problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
    this.name = 'TelemetryEnvironmentError';
    this.problems = problems;
  }
}

/**
 * One integer, with a default, refused when malformed.
 *
 * The refusal names the key, the value received and the range — the three things an
 * operator needs and the three things a bare "invalid configuration" withholds.
 */
function readInteger(
  source: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
  what: string,
  problems: string[],
): number | undefined {
  const raw = source[key];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    problems.push(`${key} must be an integer, received ${typeof raw}`);
    return undefined;
  }
  const text = String(raw);
  if (!/^-?\d+$/.test(text)) {
    problems.push(
      `${key} must be a whole number, received '${text}'. It is ${what}, and a value nobody can parse ` +
        'is a telemetry pipeline that never raises anything.',
    );
    return undefined;
  }
  const value = Number.parseInt(text, 10);
  if (value < minimum || value > maximum) {
    problems.push(
      `${key} must be between ${String(minimum)} and ${String(maximum)}, received ${String(value)} — ${what}.`,
    );
    return undefined;
  }
  return value;
}

/**
 * Reads and validates the namespace.
 *
 * **All the problems are reported in one error.** A boot that names one of seven
 * bad keys sends the operator round the loop six more times.
 */
export function loadTelemetryEnvironment(
  source: Readonly<Record<string, unknown>>,
): TelemetryEnvironment {
  const problems: string[] = [];

  const windowSeconds = readInteger(
    source,
    'SECURITY_TELEMETRY_WINDOW_SECONDS',
    DEFAULT_TELEMETRY_WINDOW_SECONDS,
    1,
    MAXIMUM_TELEMETRY_SECONDS,
    'how long one pattern\'s window stays open',
    problems,
  );
  const alertThreshold = readInteger(
    source,
    'SECURITY_TELEMETRY_ALERT_THRESHOLD',
    DEFAULT_TELEMETRY_ALERT_THRESHOLD,
    1,
    1_000_000,
    'how many matching requests inside one window raise an alert',
    problems,
  );
  const flushSeconds = readInteger(
    source,
    'SECURITY_TELEMETRY_FLUSH_SECONDS',
    DEFAULT_TELEMETRY_FLUSH_SECONDS,
    1,
    MAXIMUM_TELEMETRY_SECONDS,
    'how often the flush job fires',
    problems,
  );
  const reputationBaseScore = readInteger(
    source,
    'SECURITY_TELEMETRY_REPUTATION_BASE_SCORE',
    DEFAULT_TELEMETRY_REPUTATION_BASE_SCORE,
    1,
    100_000,
    'the score a host starts at, and the ceiling of the scale',
    problems,
  );
  const reputationPenalty = readInteger(
    source,
    'SECURITY_TELEMETRY_REPUTATION_PENALTY',
    DEFAULT_TELEMETRY_REPUTATION_PENALTY,
    0,
    100_000,
    'what one observed failure or pattern costs a host',
    problems,
  );
  const reputationSuspiciousScore = readInteger(
    source,
    'SECURITY_TELEMETRY_REPUTATION_SUSPICIOUS_SCORE',
    DEFAULT_TELEMETRY_REPUTATION_SUSPICIOUS_SCORE,
    0,
    100_000,
    'the score below which a host is called suspicious',
    problems,
  );
  const reputationBadScore = readInteger(
    source,
    'SECURITY_TELEMETRY_REPUTATION_BAD_SCORE',
    DEFAULT_TELEMETRY_REPUTATION_BAD_SCORE,
    0,
    100_000,
    'the score below which a host is called bad',
    problems,
  );

  if (
    windowSeconds === undefined ||
    alertThreshold === undefined ||
    flushSeconds === undefined ||
    reputationBaseScore === undefined ||
    reputationPenalty === undefined ||
    reputationSuspiciousScore === undefined ||
    reputationBadScore === undefined
  ) {
    throw new TelemetryEnvironmentError(problems);
  }

  // The two bands have to be ORDERED, or a host's status is decided by whichever
  // comparison happens to run first. A configuration where "bad" is above
  // "suspicious" is not a tuning mistake; it is a status nobody can read.
  if (reputationBadScore > reputationSuspiciousScore) {
    problems.push(
      `SECURITY_TELEMETRY_REPUTATION_BAD_SCORE (${String(reputationBadScore)}) must not be above ` +
        `SECURITY_TELEMETRY_REPUTATION_SUSPICIOUS_SCORE (${String(reputationSuspiciousScore)}): a host's status ` +
        'is decided by comparing its score against these two bands, and an inverted pair makes the status arbitrary.',
    );
    throw new TelemetryEnvironmentError(problems);
  }
  if (reputationSuspiciousScore > reputationBaseScore) {
    problems.push(
      `SECURITY_TELEMETRY_REPUTATION_SUSPICIOUS_SCORE (${String(reputationSuspiciousScore)}) must not be above ` +
        `SECURITY_TELEMETRY_REPUTATION_BASE_SCORE (${String(reputationBaseScore)}): no host can reach a score above ` +
        'the scale it starts on.',
    );
    throw new TelemetryEnvironmentError(problems);
  }

  return {
    windowSeconds,
    alertThreshold,
    flushSeconds,
    reputationBaseScore,
    reputationPenalty,
    reputationSuspiciousScore,
    reputationBadScore,
  };
}
