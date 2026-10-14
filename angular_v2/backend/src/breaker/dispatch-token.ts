/**
 * `service.method`, the unit both `BREAKER_PROTECTED` and the gate speak.
 *
 * A token is a **dispatch site**, not a route: `breaker.meter` and
 * `breaker.gate` have no HTTP route at all, and `purge.sweeper` and
 * `purge.enqueuer` are scheduled jobs. Keeping all four in one vocabulary is what
 * lets the protected list mean the same thing to the interceptor and to the job
 * dispatcher, instead of growing a second naming convention nobody cross-checks.
 *
 * **An unknown token in the PROTECTION LIST is a boot error, not a warning.** A
 * typo in `BREAKER_PROTECTED` means the site it was supposed to protect is
 * sheddable, and that is the dangerous direction: the omission is invisible at
 * runtime, the site simply runs through a memory crisis while the breaker
 * reports the crisis accurately to everybody else.
 *
 * That check is **one-directional**, and the distinction is the whole of the
 * next block: `BREAKER_PROTECTED` cannot name a token this build does not know,
 * and nothing in this build can tell the reverse — that a route exists which no
 * token names. Read the note on `KNOWN_DISPATCH_TOKENS` before assuming the list
 * below is a census of routes. It is not, and nothing enforces that it is.
 */

export const DISPATCH_TOKEN_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** The token shape, as a type. */
export type DispatchToken = string;

export const AUTH_LOGIN: DispatchToken = 'auth.login';
export const AUTH_REFRESH: DispatchToken = 'auth.refresh';
export const AUTH_LOGOUT: DispatchToken = 'auth.logout';
export const AUTH_ME: DispatchToken = 'auth.me';
export const BREAKER_METER: DispatchToken = 'breaker.meter';
export const BREAKER_GATE: DispatchToken = 'breaker.gate';
export const PURGE_SWEEPER: DispatchToken = 'purge.sweeper';

/**
 * `PurgeEnqueuer` — the retention scan that FILLS the queue the sweeper drains.
 *
 * ## Why the token exists at all, given what it used to be
 *
 * `PurgeEnqueuer` used to pass `undefined` here, with a comment saying so and
 * calling it the honest fix. That was fail-closed and it was undocumented
 * infrastructure behaving by accident: `undefined` is the gate's "this build
 * cannot name this site" answer, so the job was *unnamed* rather than *shedding
 * the right way*. A reader of `BREAKER_PROTECTED` could not tell whether the
 * absence was a decision.
 *
 * ## Why it is NOT in `BREAKER_PROTECTED` — and why the next reader must not "fix" that
 *
 * **The default is STOP, and shedding this job under memory pressure is correct
 * behaviour, not a gap.** `BREAKER_PROTECTED` holds exactly six tokens, and every
 * one of them is request-path work whose caller is waiting: four `auth.*` routes,
 * plus `breaker.meter` and `breaker.gate`, which are protected because a breaker
 * that stops measuring cannot stop anything.
 *
 * This job is the opposite of all six. It is **batch work with nobody waiting**: an
 * hourly scan over tombstones, enqueueing in one transaction, with no request
 * anywhere near it. Deferring NEW enqueues while the machine is unhealthy is
 * exactly the right answer, and the queue already holds whatever was enqueued
 * before the pressure started — `PurgeSweeper` keeps draining it. **Adding
 * `purge.enqueuer` to `BREAKER_PROTECTED` would make a job nobody is waiting on
 * run through a memory crisis to produce more work for a job that is being held
 * back.** The omission is deliberate. If you are reading this because the enqueuer
 * seems to be the one job missing from the list, that is this paragraph.
 *
 * Being sheddable is not the same as being unprotected. It still asks the gate for
 * a **stoppable** lease (`PurgeEnqueuer.sweep(nowMs)` passes `stoppable = true`), so
 * a scan already in flight is aborted mid-transaction and the transaction rolls
 * back whole — a queue row exists for every due tombstone or for none of them.
 */
export const PURGE_ENQUEUER: DispatchToken = 'purge.enqueuer';

/**
 * Every dispatch site this build knows about.
 *
 * The interceptor derives a token from `AuthController` + method name, and the
 * four jobs below name themselves. **Membership here means exactly one thing:**
 * `BREAKER_PROTECTED` may name the token, so a site that carries it is admitted
 * at every zone including `red`. Absence means the opposite — an unnamed site is
 * *unnamed*, and unnamed is not protected, so it is sheddable while the breaker
 * is open. Being in this list is therefore **not** a protection, and adding a
 * token here is not a statement that it should survive an open breaker; see
 * `PURGE_ENQUEUER`, which is named, sheddable, and says why.
 *
 * ## This is not a route-coverage gate, and nothing here enforces completeness
 *
 * An earlier version of this comment claimed that a route added without a line
 * here *fails the boot*. **Nothing implements that.** `dispatchTokenForRoute`
 * below returns `undefined` for anything this build cannot name; no code path
 * and no test walks the mounted routes and compares them against this array. A
 * route added without a line is therefore **silently sheddable** — admitted
 * while the breaker is closed, `202` and not dispatched once it opens, with
 * nothing anywhere saying the site was never classified.
 *
 * That is the same defect family this build has already paid for in both
 * directions, and both instances are in the tree. **The fixture direction:**
 * `test/e2e/email.e2e-spec.ts`'s `EmailProbeController` is a mounted route that no
 * token names, so it is breakable — and the cold-start window (`breaker-state.ts`)
 * is what turned that from a theoretical gap into a red test. **The protection-list
 * direction:** a typo in `BREAKER_PROTECTED` is a site that is sheddable while the
 * operator reads the breaker reporting the crisis accurately. This list is the
 * third spelling of the same omission, and the only one with no check behind it.
 *
 * **Why the gate is not built, stated so it is not re-proposed as a one-liner.**
 * The obvious implementation is a boot-time walk of the mounted routes. It
 * cannot be correct without also deciding what a *test* route is:
 * `test/e2e/email.e2e-spec.ts` mounts `EmailProbeController` into `AppModule`,
 * and by the same construction that is a dispatch site — the global interceptor
 * really does run on it. A gate that treats it as one fails the boot of a
 * legitimate fixture, and the only two ways to make it pass are the two this
 * comment refuses to suggest: adding the fixture's routes to
 * `BREAKER_PROTECTED`, which makes the symptom vanish while the real defect — no
 * route is ever checked — stays exactly where it was; or exempting test
 * environments, which is a `NODE_ENV` branch around a security control and
 * therefore a silent weakening (AGENTS.md §2.3).
 *
 * **Where that leaves the check: a review item, recorded as one**
 * (`docs/rebase.md` §9B.12) rather than dressed up as a gate. The honest
 * statement for the next reader is the one this comment makes: *a new route is
 * breakable until somebody names it, on purpose.*
 */
export const KNOWN_DISPATCH_TOKENS: readonly DispatchToken[] = Object.freeze([
  AUTH_LOGIN,
  AUTH_REFRESH,
  AUTH_LOGOUT,
  AUTH_ME,
  BREAKER_METER,
  BREAKER_GATE,
  PURGE_SWEEPER,
  PURGE_ENQUEUER,
]);

/**
 * `AuthController` + `login` → `auth.login`.
 *
 * Returns `undefined` for anything this build cannot name, and the caller treats
 * `undefined` as **not protected** — fail closed. A route the gate cannot name is
 * breakable, which is the direction where being wrong is visible: the site is
 * sheddable rather than silently exempt, so the mistake shows up as a `202` under
 * memory pressure instead of as a site quietly running through one.
 *
 * **The complement of that is the honest limit.** Nothing walks the mounted
 * routes, so `undefined` here is reached by every route that was never added to
 * `KNOWN_DISPATCH_TOKENS` — and with the shipped `BREAKER_PROTECTED` the whole
 * thin-app surface is named, so the interceptor's refusal branch has no runtime
 * exercise at all. See the note on `KNOWN_DISPATCH_TOKENS` for why that check is
 * not built rather than merely missing.
 */
export function dispatchTokenForRoute(controllerName: string, handlerName: string): DispatchToken | undefined {
  const service = controllerName.replace(/Controller$/, '').toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(service)) {
    return undefined;
  }
  const candidate = `${service}.${handlerName}`;
  return KNOWN_DISPATCH_TOKENS.includes(candidate) ? candidate : undefined;
}