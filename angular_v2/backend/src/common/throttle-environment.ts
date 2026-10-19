/**
 * The `THROTTLE_*` namespace, read once and asserted at boot.
 *
 * ## WHAT THIS LIMITS, AND WHAT IT DOES NOT
 *
 * `AGENTS.md` §B6 asks for two different things, and this file holds the numbers
 * for the OUTER one:
 *
 *   - **per-account failure counting** (primary) — already shipped, and it lives
 *     in `src/auth/throttle.ts` with the database behind it. It counts failures
 *     against an ACCOUNT, which is the axis an attacker aiming at one account
 *     cannot rotate.
 *   - **an address-keyed limiter** (outer) — this namespace. It counts REQUESTS
 *     against a source address, which is the axis an attacker aiming at MANY
 *     accounts from one host cannot rotate.
 *
 * They are not substitutes and neither is optional. A party spraying one account
 * from many addresses spends the per-account budget and is invisible to the
 * address axis; a party spraying many accounts from one address spends the
 * address budget and never trips a per-account threshold. §B6's own words —
 * "Never a hard lock from unauthenticated traffic, that is a denial-of-service on
 * every account" — are why the numbers below are as generous as they are: an
 * address-keyed lock is a lock on EVERY account behind that address (an office, a
 * carrier NAT, a university), so these limits shed VOLUME and the per-account gate
 * is what stops an attack on one person.
 *
 * ## WHY EVERY KEY HERE HAS A DEFAULT
 *
 * `notification-environment.ts` draws the line and this namespace sits on the same
 * side of it deliberately. There, a key decides WHEN a job fires or HOW FAR BACK it
 * looks — neither of which is a decision about whose data ends. Here, a key decides
 * how many requests one source address may make in one window: it is an operating
 * point, not a published key and not a credential, so a default is allowed.
 *
 * **A MALFORMED value is still refused at boot, naming the key, the value received
 * and the range.** `THROTTLE_LIMIT=0` is not "no limit", `THROTTLE_TTL_SECONDS=1h`
 * is not an hour, and a limit that silently becomes something else is a limit nobody
 * chose. The refusal happens at module-evaluation time, before the process serves a
 * request.
 *
 * ## Why this is a second loader and not a field of `Environment`
 *
 * `breaker-environment.ts` gives the argument and `notification-environment.ts`
 * repeats it: `Environment` is asserted key-for-key by
 * `test/unit/environment.spec.ts`, one namespace one loader is the rule the
 * existing loaders established, and an operator reading `THROTTLE_LIMIT` is not
 * sent looking for the rate limit two files away.
 *
 * ## Why the loader is separate from the module that reads it
 *
 * The values here are read at IMPORT time, because `@Throttle(...)` is a decorator
 * and a decorator is evaluated when the controller module is imported — before Nest
 * exists and before any provider factory has run. A number that came from the DI
 * container could not reach a decorator. So this file is a pure function over a
 * source, and `src/common/throttle.ts` is the one place the process environment
 * is read.
 */

/**
 * The window every limit is counted over, in seconds.
 *
 * The unit is SECONDS because every other window in this repository is
 * (`SECURITY_FAILURE_WINDOW_SECONDS`, `JWT_ACCESS_TOKEN_TTL_SECONDS`,
 * `RETENTION_*_DAYS`). The conversion to the milliseconds `@nestjs/throttler`
 * counts in happens once, in `src/common/throttle.ts`.
 */
export type ThrottleEnvironment = {
  /** Requests per window, per source address, per route. The global allowance. */
  readonly limit: number;
  /** The window every limit is counted over. */
  readonly ttlSeconds: number;
  /** The allowance for the routes that check or move a credential. */
  readonly credentialLimit: number;
  /** The allowance for the routes that send a one-time link. */
  readonly linkLimit: number;
};

/**
 * 300 requests per minute, per address, per route.
 *
 * **Deliberately generous**, because this is the allowance every route nobody
 * thought about inherits, and the failure it must not cause is a self-inflicted
 * outage: a page that makes a dozen calls, a client that polls a read, an office
 * behind one NAT address. Five a second on ONE route from ONE address is a
 * script, not a person — and a client that polls a read faster than that is a
 * client the limiter should not be deciding anything about.
 */
export const DEFAULT_THROTTLE_LIMIT = 300;

/**
 * 60 seconds.
 *
 * The window every limit is counted over, so it is also the window after which a
 * counter is empty again. A minute is long enough that a person's burst of retries
 * lands inside one window (a mistyped password, a double-clicked button) and short
 * enough that a limit is never a lasting punishment.
 */
export const DEFAULT_THROTTLE_TTL_SECONDS = 60;

/**
 * 30 requests per window on the routes that check or move a credential.
 *
 * Ten times tighter than the global allowance, and still far above what a person
 * needs: a mistyped password is retried a handful of times, not thirty, and an
 * office whose members sign in at the same time share one address. The control
 * that actually stops a credential attack against ONE account is the per-account
 * gate in `src/auth/throttle.ts` (five failures, then a progressive delay and a
 * block) — this number is here to shed the VOLUME of a script, not to replace
 * that gate.
 */
export const DEFAULT_THROTTLE_CREDENTIAL_LIMIT = 30;

/**
 * 15 requests per window on the routes that send a one-time link.
 *
 * Twenty times tighter than the global allowance, because each of these costs an
 * SMTP round trip — the most expensive thing this application does that is not a
 * bcrypt hash — and because a request for a link is an act against a MAILBOX: the
 * per-address budget in `login_attempts` (five per ten minutes) is what stops the
 * bombing of one inbox, and this is what stops the volume from one address.
 */
export const DEFAULT_THROTTLE_LINK_LIMIT = 15;

/**
 * An hour, as a ceiling on the window.
 *
 * Past an hour the value is far more likely to be a units mistake — milliseconds
 * typed into a key that wanted seconds — than a window anybody wants. This is the
 * same reasoning `MAXIMUM_SECONDS` records in `notification-environment.ts`.
 */
export const MAXIMUM_SECONDS = 3600;

/**
 * A hundred thousand requests per window, as a ceiling on the counts.
 *
 * A number that large is not a policy; it is a unit or a typo, and the cost of
 * accepting it is a limiter that does not limit. The ceiling is high enough that
 * no real deployment is near it.
 */
export const MAXIMUM_LIMIT = 100_000;

export class ThrottleEnvironmentError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `The throttle configuration is not usable. ${String(problems.length)} problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
    this.name = 'ThrottleEnvironmentError';
    this.problems = problems;
  }
}

/**
 * One integer, with a default, refused when malformed.
 *
 * The refusal names the key, the value received and the range — the three things
 * an operator needs and the three things a bare "invalid configuration" withholds.
 * `what` says what the number decides, because `THROTTLE_LIMIT=60` and
 * `THROTTLE_TTL_SECONDS=60` are both valid and mean opposite things.
 */
function readInteger(
  source: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
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
  if (!/^\d+$/.test(text)) {
    problems.push(
      `${key} must be a whole number, received '${text}'. It is ${what}, and a value nobody can ` +
        'parse is a limiter running with a window that does not exist.',
    );
    return undefined;
  }
  const value = Number.parseInt(text, 10);
  if (value < 1 || value > maximum) {
    problems.push(
      `${key} must be between 1 and ${String(maximum)}, received ${String(value)} — ${what}. ` +
        'Zero is refused too: it does not mean "no limit", it means the mechanism is silently switched off.',
    );
    return undefined;
  }
  return value;
}

/**
 * Reads the `THROTTLE_*` namespace and returns it, or throws naming every problem
 * at once.
 *
 * **Every problem is collected before anything is returned.** A misconfigured
 * checkout is fixed in one pass, and an early return on the first bad key turns
 * that into four round trips — the shape `loadEnvironment`,
 * `loadNotificationEnvironment` and `loadErasureEnvironment` all use.
 */
export function loadThrottleEnvironment(
  source: Readonly<Record<string, unknown>>,
): ThrottleEnvironment {
  const problems: string[] = [];

  const limit = readInteger(
    source,
    'THROTTLE_LIMIT',
    DEFAULT_THROTTLE_LIMIT,
    MAXIMUM_LIMIT,
    'how many requests one source address may make to one route in one window',
    problems,
  );
  const ttlSeconds = readInteger(
    source,
    'THROTTLE_TTL_SECONDS',
    DEFAULT_THROTTLE_TTL_SECONDS,
    MAXIMUM_SECONDS,
    'the window every limit is counted over',
    problems,
  );
  const credentialLimit = readInteger(
    source,
    'THROTTLE_CREDENTIAL_LIMIT',
    DEFAULT_THROTTLE_CREDENTIAL_LIMIT,
    MAXIMUM_LIMIT,
    'how many requests one source address may make to a route that checks or moves a credential',
    problems,
  );
  const linkLimit = readInteger(
    source,
    'THROTTLE_LINK_LIMIT',
    DEFAULT_THROTTLE_LINK_LIMIT,
    MAXIMUM_LIMIT,
    'how many requests one source address may make to a route that sends a one-time link',
    problems,
  );

  if (
    limit === undefined ||
    ttlSeconds === undefined ||
    credentialLimit === undefined ||
    linkLimit === undefined
  ) {
    throw new ThrottleEnvironmentError(problems);
  }

  return { limit, ttlSeconds, credentialLimit, linkLimit };
}
