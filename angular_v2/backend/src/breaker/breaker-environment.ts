import { DISPATCH_TOKEN_PATTERN, KNOWN_DISPATCH_TOKENS } from './dispatch-token.js';
import type { DispatchToken } from './dispatch-token.js';
import type { BreakerThresholds } from './breaker-thresholds.js';
import type { BreakerRuntime } from './breaker-state.js';

/**
 * The `BREAKER_*` namespace, read once and asserted at boot.
 *
 * **Every breaker key is REQUIRED and has NO default.** That is not
 * fastidiousness, it is the same rule `loadEnvironment` already applies to
 * `JWT_SECRET` (§2.3): a default nobody chose silently applies, and the two
 * defaults that matter most here are the ones an operator will believe they
 * changed. The reference implementation this design came from reads
 * `parseInt(process.env.ETL_MEMORY_GREEN_ZONE) || 60` — a fallback that
 * hardcodes the same number a second time, in a second file, so changing one has
 * changed one of two, and `ETL_MEMORY_YELLOW_ZONE` does not exist at all, so the
 * middle band is unconfigurable and different between its two consumers.
 *
 * The two *operational* keys the sweeper owns (`PURGE_POLL_SECONDS`,
 * `PURGE_DRAIN_BUDGET`, `RETENTION_PURGE_MAX_ATTEMPTS`) DO carry documented
 * defaults, because they are scheduling facts rather than decisions, and
 * `SECURITY_DELAY_SCHEDULE_SECONDS` in `environment.ts` sets that precedent with
 * the same reasoning. Every threshold that decides whether the process stops
 * working is required; none of them has one.
 *
 * ## Why this is a second loader and not a branch of `loadEnvironment`
 *
 * `Environment` is asserted key-for-key by `test/unit/environment.spec.ts`
 * (a `toEqual` over the whole object), which is not in this change's ownership —
 * extending the `Environment` shape would have required editing somebody else's
 * test to land a bug fix. The follow-up is one field in `Environment` plus one
 * expectation in that spec; until then this loader is called from `app.module.ts`
 * immediately beside `loadEnvironment`, at the same moment (module evaluation,
 * before `ConfigModule.forRoot()` and before any Nest call), so a misconfigured
 * breaker is still one attributed boot failure naming every problem rather than
 * a rejection from inside module initialisation.
 */
export type BreakerEnvironment = {
  readonly thresholds: BreakerThresholds;
  readonly pollSeconds: number;
  readonly cooldownSeconds: number;
  readonly probeTimeoutSeconds: number;
  readonly protectedTokens: readonly DispatchToken[];
  /** Sweeper schedule. Separate from the meter's, so neither gates the other. */
  readonly purgePollSeconds: number;
  /** The drain budget: one sweeper tick can never claim more than this many purges. */
  readonly purgeDrainBudget: number;
  /** Attempts before a poison pill is written off as `failed` and left visible. */
  readonly purgeMaxAttempts: number;
};

export const DEFAULT_PURGE_POLL_SECONDS = 60;
export const DEFAULT_PURGE_DRAIN_BUDGET = 100;
export const DEFAULT_PURGE_MAX_ATTEMPTS = 3;

/**
 * The gate's tick is offset from the meter's by a constant rather than configured
 * separately.
 *
 * A second key would be a second number to get wrong, and this is not a threshold
 * — it changes no decision, only when the gate re-reads what the meter published.
 * The offset is not a multiple of the meter period, so the two ticks do not land
 * together and the gate does not always read a reading that is up to a full poll
 * old.
 */
export const GATE_INTERVAL_OFFSET_MS = 7000;

/**
 * The DI token for the validated configuration.
 *
 * A `BreakerEnvironment` is a plain object, so it cannot be its own injection
 * token, and a string token is used rather than a class that does not exist —
 * the token names a value the loader produced, and the two are created together in
 * `breaker.module.ts` so nothing can register one without the other.
 */
export const BREAKER_ENV = 'BREAKER_ENVIRONMENT';

export class BreakerEnvironmentError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `The breaker configuration is not usable. ${problems.length} problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
    this.name = 'BreakerEnvironmentError';
    this.problems = problems;
  }
}

const MINIMUM_THRESHOLD = 1;
const MAXIMUM_THRESHOLD = 100;

function readInteger(
  source: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
  fallback: number | undefined,
): number | undefined {
  const raw = source[key];
  if (raw === undefined || raw === null || raw === '') {
    if (fallback === undefined) {
      problems.push(`${key} is required but was not set`);
      return undefined;
    }
    return fallback;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    problems.push(`${key} must be an integer, received ${typeof raw}`);
    return undefined;
  }
  const text = String(raw);
  if (!/^\d+$/.test(text)) {
    problems.push(`${key} must be a positive integer, received '${text}'`);
    return undefined;
  }
  const value = Number.parseInt(text, 10);
  if (value < 1) {
    problems.push(`${key} must be greater than zero, received ${value}`);
    return undefined;
  }
  return value;
}

/**
 * The three bands, in one place, so the ordering cannot be asserted three times
 * in three shapes.
 *
 * `90/60/60` is the plausible copy-paste — green set to red, yellow left where it
 * was. It is not a syntax error. It boots, it yields an empty yellow band and a
 * trip condition reached at the same value as green, and the result is a breaker
 * that never trips on a machine reporting itself healthy with no warning
 * anywhere. Failing the boot is the only defence.
 */
function readThresholds(
  source: Readonly<Record<string, unknown>>,
  problems: string[],
): BreakerThresholds | undefined {
  const green = readInteger(source, 'BREAKER_MEMORY_GREEN', problems, undefined);
  const yellow = readInteger(source, 'BREAKER_MEMORY_YELLOW', problems, undefined);
  const red = readInteger(source, 'BREAKER_MEMORY_RED', problems, undefined);
  if (green === undefined || yellow === undefined || red === undefined) {
    return undefined;
  }
  const bands: ReadonlyArray<readonly [string, number]> = [
    ['BREAKER_MEMORY_GREEN', green],
    ['BREAKER_MEMORY_YELLOW', yellow],
    ['BREAKER_MEMORY_RED', red],
  ];
  const outOfRange = bands
    .filter(([, value]) => value < MINIMUM_THRESHOLD || value > MAXIMUM_THRESHOLD)
    .map(([key, value]) => `${key} must be between ${MINIMUM_THRESHOLD} and ${MAXIMUM_THRESHOLD}, received ${value}`);
  if (outOfRange.length > 0) {
    problems.push(...outOfRange);
    return undefined;
  }
  if (!(green < yellow && yellow < red)) {
    problems.push(
      `BREAKER_MEMORY_GREEN < BREAKER_MEMORY_YELLOW < BREAKER_MEMORY_RED is required, received ${green}/${yellow}/${red}: ` +
        'an ordering that does not hold produces a breaker whose trip condition is reached at the same value as its healthy zone, so it never trips and reports nothing wrong',
    );
    return undefined;
  }
  return { green, yellow, red };
}

/**
 * The protected list. Every token must name a dispatch site that EXISTS.
 *
 * An unknown token is a boot error, not a warning, because a typo here means the
 * site it was meant to protect is now sheddable — and that failure is invisible
 * at runtime: the site simply keeps running through a memory crisis while the
 * breaker reports the crisis accurately to everybody else.
 */
function readProtected(source: Readonly<Record<string, unknown>>, problems: string[]): DispatchToken[] | undefined {
  const raw = source['BREAKER_PROTECTED'];
  if (raw === undefined || raw === null || raw === '') {
    problems.push('BREAKER_PROTECTED is required but was not set');
    return undefined;
  }
  if (typeof raw !== 'string') {
    problems.push(`BREAKER_PROTECTED must be a comma-separated list of service.method tokens, received ${typeof raw}`);
    return undefined;
  }
  const tokens = raw.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
  if (tokens.length === 0) {
    problems.push('BREAKER_PROTECTED must name at least one dispatch site');
    return undefined;
  }
  const problemsBefore = problems.length;
  const accepted: DispatchToken[] = [];
  for (const token of tokens) {
    if (!DISPATCH_TOKEN_PATTERN.test(token)) {
      problems.push(`BREAKER_PROTECTED entry '${token}' is not a service.method token such as 'auth.login'`);
      continue;
    }
    if (!KNOWN_DISPATCH_TOKENS.includes(token)) {
      problems.push(
        `BREAKER_PROTECTED entry '${token}' names no dispatch site in this build ` +
          `(known: ${KNOWN_DISPATCH_TOKENS.join(', ')}): a typo here leaves that site sheddable, which is invisible until it matters`,
      );
      continue;
    }
    if (accepted.includes(token)) {
      problems.push(`BREAKER_PROTECTED names '${token}' more than once`);
      continue;
    }
    accepted.push(token);
  }
  return problems.length === problemsBefore ? accepted : undefined;
}

export function loadBreakerEnvironment(source: Readonly<Record<string, unknown>>): BreakerEnvironment {
  const problems: string[] = [];
  const thresholds = readThresholds(source, problems);
  const pollSeconds = readInteger(source, 'BREAKER_POLL_SECONDS', problems, undefined);
  const cooldownSeconds = readInteger(source, 'BREAKER_COOLDOWN_SECONDS', problems, undefined);
  const probeTimeoutSeconds = readInteger(source, 'BREAKER_PROBE_TIMEOUT_SECONDS', problems, undefined);
  const protectedTokens = readProtected(source, problems);
  const purgePollSeconds = readInteger(source, 'PURGE_POLL_SECONDS', problems, DEFAULT_PURGE_POLL_SECONDS);
  const purgeDrainBudget = readInteger(source, 'PURGE_DRAIN_BUDGET', problems, DEFAULT_PURGE_DRAIN_BUDGET);
  const purgeMaxAttempts = readInteger(source, 'RETENTION_PURGE_MAX_ATTEMPTS', problems, DEFAULT_PURGE_MAX_ATTEMPTS);

  if (
    thresholds === undefined ||
    pollSeconds === undefined ||
    cooldownSeconds === undefined ||
    probeTimeoutSeconds === undefined ||
    protectedTokens === undefined ||
    purgePollSeconds === undefined ||
    purgeDrainBudget === undefined ||
    purgeMaxAttempts === undefined
  ) {
    throw new BreakerEnvironmentError(problems);
  }

  return {
    thresholds,
    pollSeconds,
    cooldownSeconds,
    probeTimeoutSeconds,
    protectedTokens,
    purgePollSeconds,
    purgeDrainBudget,
    purgeMaxAttempts,
  };
}

/** The subset the state machine needs. One value, built once, never re-derived. */
export function breakerRuntimeOf(env: BreakerEnvironment): BreakerRuntime {
  return {
    thresholds: env.thresholds,
    pollSeconds: env.pollSeconds,
    cooldownSeconds: env.cooldownSeconds,
    probeTimeoutSeconds: env.probeTimeoutSeconds,
    protectedTokens: env.protectedTokens,
  };
}