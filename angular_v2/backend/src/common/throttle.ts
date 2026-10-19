/**
 * The rate limiter's resolved configuration, and the two decorators the routes
 * use.
 *
 * ## THE IN-PROCESS LIMITATION, STATED WHERE THE MODULE IS READ
 *
 * `@nestjs/throttler` keeps its counters in MEMORY, in this process. That is
 * the limitation to know about before trusting a number in this file:
 *
 *   - **The counters reset when the process restarts.** A deployment that
 *     restarts under attack starts every window at zero. The per-account gate
 *     does not have this property — its counters are rows in `login_attempts`,
 *     and they survive a restart — which is one more reason the per-account
 *     layer is the primary one.
 *   - **The effective limit is multiplied by the number of instances.** Two
 *     processes behind one load balancer enforce the limit twice over, because
 *     each has its own counters and neither can see the other's. A limit of
 *     20 is a limit of 40 in a two-instance deployment.
 *   - **Nothing is shared with the other process that matters most.** The CRUD
 *     layer is PostgREST's (§B1), and PostgREST does not rate-limit at all;
 *     §B6's answer for that surface is a reverse proxy in front of it, not
 *     this guard. The read-heavy traffic a real client generates never reaches
 *     this process, so the limit below is a limit on the THIN app's own
 *     routes and on nothing else.
 *
 * The comment lives HERE, in the module whose numbers it qualifies, because a
 * limitation written in a document nobody reads is a limitation nobody knows
 * they are relying on.
 *
 * ## WHY THE VALUES ARE RESOLVED AT IMPORT TIME
 *
 * `@Throttle({...})` is a decorator: it is evaluated when the controller
 * module is imported, which is before Nest exists and before any provider
 * factory has run. A number that came from the DI container could not reach
 * it. So the configuration is read here, once, at module-evaluation time, and
 * the routes carry the resolved numbers — which is why
 * `src/common/throttle-environment.ts` exists as a separate, pure loader.
 *
 * ## THE TWO LAYERS, AND WHICH ONE IS WHICH
 *
 * The per-account gate (`src/auth/throttle.ts`, backed by `login_attempts`) is
 * PRIMARY: it counts failures against an account and applies a progressive
 * delay and then a block. This limiter is OUTER: it counts requests against a
 * source address and sheds volume. §B6 forbids a hard lock from unauthenticated
 * traffic, because an address-keyed lock is a lock on every account behind
 * that address — so the numbers here are set to shed load without denying
 * service to a specific person, and the per-account gate is what stops a
 * credential attack against one account.
 */

import '../config/load-env-file.js';
import { SkipThrottle } from '@nestjs/throttler';
import { ipSubnetKey, normalizeIpAddress } from '../auth/ip-address.js';
import { loadThrottleEnvironment } from './throttle-environment.js';

/**
 * The validated `THROTTLE_*` namespace, read once.
 *
 * `import '../config/load-env-file.js'` above is not decoration: this module
 * reads `process.env`, and the environment file has to be in `process.env`
 * before it is read. The import makes that ordering true no matter which
 * module of the graph is imported first — the same guarantee
 * `app.module.ts` gets from its own first import, and the same file, so
 * there is one loader and one mode decision in the process.
 */
export const THROTTLE_ENVIRONMENT = loadThrottleEnvironment(process.env);

/**
 * One limit, in the unit `@nestjs/throttler` counts in.
 *
 * `ttl` is MILLISECONDS: the library's own unit, and the conversion from the
 * SECONDS in the configuration happens exactly once, here.
 */
export type ThrottlePolicy = {
  /** Requests allowed per window, per source address, per route. */
  readonly limit: number;
  /** The window, in milliseconds. */
  readonly ttl: number;
};

const TTL_MS = THROTTLE_ENVIRONMENT.ttlSeconds * 1000;

/**
 * The three policies the routes use.
 *
 * **One named throttler, three limits.** `@nestjs/throttler` keeps a separate
 * bucket per (route, tracker), so a route's limit is that route's limit and
 * never a share of one global bucket: two limits on two routes cannot collide,
 * and a flood on one route cannot spend another's budget. The policies differ
 * only in the NUMBER, and a route's policy replaces the global allowance for
 * that route rather than adding to it.
 */
export const THROTTLE_POLICIES = {
  /** Everything that is not tightened and not exempt. */
  global: { limit: THROTTLE_ENVIRONMENT.limit, ttl: TTL_MS },
  /** The routes that check or move a credential. */
  credential: { limit: THROTTLE_ENVIRONMENT.credentialLimit, ttl: TTL_MS },
  /** The routes that send a one-time link. */
  link: { limit: THROTTLE_ENVIRONMENT.linkLimit, ttl: TTL_MS },
} as const;

/**
 * The answer a refused request gets.
 *
 * **It must not read like the credential refusal.** `401 invalid credentials`
 * says "that was the wrong password"; this says "slow down". A client that
 * cannot tell them apart retries a wrong password at full speed, which is the
 * opposite of what the limit is for. The status code already separates them;
 * the message is what a human reads in a network tab, and it says what is
 * true.
 */
export const THROTTLE_ERROR_MESSAGE = 'too many requests from this network — wait before trying again';

/**
 * The source address a request is counted against.
 *
 * **The repository's own canonical form, not the library's.** `src/auth/ip-address.ts`
 * already decides what "the same host" means for the per-account gate: an
 * IPv4-mapped IPv6 address is the IPv4 address, a leading zero is not a
 * different octet, and an IPv6 address aggregates to its /64. The two layers
 * MUST agree on that, or a party that rotates the SPELLING of one address
 * would spend the per-account budget while the IP axis counted each spelling
 * separately — the exact rotation the canonical form exists to close.
 *
 * The key is the SUBNET, not the address: an IPv4 host is a /32 and an IPv6
 * subscriber's /64 is one subscriber, which is §B6's "aggregate to a subnet".
 */
export function throttleTracker(request: Record<string, unknown>): string {
  const ip = request['ip'];
  return ipSubnetKey(normalizeIpAddress(typeof ip === 'string' ? ip : undefined));
}

/**
 * Exempts a route from the limiter.
 *
 * §B6 asks for "the exported `ThrottleSkip`", and this is it: the library's own
 * `SkipThrottle`, exported under the name this repository documents, so a route
 * that must not be limited says so with the same vocabulary as the one that
 * tightens a route. `SkipThrottle({ default: true })` names the single
 * configured throttler explicitly, because `SkipThrottle()` with no argument
 * would skip a throttler named `default` — which happens to be the only one
 * here, and would silently stop exempting anything if a second were added.
 *
 * **Use it where a limit would be WRONG, not where a limit is inconvenient.**
 * The reason a route is exempt is written on the route.
 */
export function ThrottleSkip(): MethodDecorator {
  return SkipThrottle({ default: true });
}
