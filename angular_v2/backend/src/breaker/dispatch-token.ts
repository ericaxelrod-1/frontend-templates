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
 * and the reverse — that a route exists which no token names — is enforced by
 * `route-census.ts`, which walks the mounted controllers on every boot.
 */

export const DISPATCH_TOKEN_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** The token shape, as a type. */
export type DispatchToken = string;

export const AUTH_LOGIN: DispatchToken = 'auth.login';
export const AUTH_REFRESH: DispatchToken = 'auth.refresh';
export const AUTH_LOGOUT: DispatchToken = 'auth.logout';
export const AUTH_ME: DispatchToken = 'auth.me';

/**
 * `POST /auth/captcha` — the challenge issuer.
 *
 * **Named, and deliberately NOT in `BREAKER_PROTECTED`.**
 *
 * Naming it is mandatory: `route-census.ts` refuses to boot a graph with a
 * mounted route no token names, so an unnamed handler stops the process at
 * startup rather than degrading quietly.
 *
 * Omitting it from the protected list means SHEDDABLE, and shedding it under
 * memory pressure is correct for the same reason the four one-time-token routes
 * are sheddable: the caller is told the machine is busy and can come back. A
 * challenge is a question, not a credential — nothing is minted by asking it and
 * nothing is consumed by failing it — so a refused issue costs the caller one
 * request and no state.
 */
export const AUTH_CAPTCHA: DispatchToken = 'auth.captcha';

/**
 * The four one-time-token routes, minted and redeemed over `src/token/`.
 *
 * **Named, and deliberately NOT in `BREAKER_PROTECTED`.**
 *
 * Naming them is mandatory: `route-census.ts` refuses to boot a graph with a
 * mounted route no token names, so an unnamed handler does not degrade — it stops
 * the process at startup. That is the control doing its job, and it is why these
 * four exist.
 *
 * Omitting them from the *protected* list is a decision, and the reasoning is the
 * same one that keeps `purge.enqueuer` out of it. The default is STOP, so an
 * omission means **sheddable**, and here shedding is the correct behaviour:
 *
 *  - `auth.password_reset_request` and `auth.email_verification_request` answer
 *    "accepted, check your mail". Holding one while the machine is in memory
 *    distress produces exactly the behaviour a client already handles, because the
 *    token was never minted — a retry costs the caller one request and mails
 *    nothing twice.
 *  - `auth.password_reset_confirm` and `auth.email_verification_confirm` are
 *    gated BEFORE the handler runs, so a gated confirm consumes no token: the
 *    link is still live afterwards and the retry succeeds. Nothing is lost, and a
 *    caller who cannot retry right now was not going to succeed anyway.
 *
 * The counter-argument is "an operator must be able to log in and fix the
 * machine", which is what protects the four `auth.*` session routes. A reset
 * confirm is not that: it is not an operator recovering access, it is a user
 * changing a password, and it can be retried in a minute. Putting it on the
 * protected list would make four more routes exempt from shedding on every host,
 * in exchange for a capability nobody needs.
 */
export const AUTH_PASSWORD_RESET_REQUEST: DispatchToken = 'auth.password_reset_request';
export const AUTH_PASSWORD_RESET_CONFIRM: DispatchToken = 'auth.password_reset_confirm';
export const AUTH_EMAIL_VERIFICATION_REQUEST: DispatchToken = 'auth.email_verification_request';
export const AUTH_EMAIL_VERIFICATION_CONFIRM: DispatchToken = 'auth.email_verification_confirm';
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
 * The authenticated account erasure route (`PrivacyController.erase`).
 *
 * Runs `ErasureService.eraseSelf` on a claimless `app_admin` session — NOT yet on the
 * identity seam (spec-identity.md), which is proven but not yet consumed here.
 * Named in `KNOWN_DISPATCH_TOKENS` so `RouteCensus` admits the mounted route at boot.
 * Sheddable under memory pressure (not in `BREAKER_PROTECTED` by default).
 */
export const PRIVACY_ERASE: DispatchToken = 'privacy.erase';

/**
 * `NotificationMaterializer` — the job that turns a source row into a row in
 * `public.admin_notifications`.
 *
 * ## Why it is NOT in `BREAKER_PROTECTED`
 *
 * The same argument `PURGE_ENQUEUER` makes, and it is worth repeating here because a
 * new token is exactly where that omission gets "fixed" by someone who reads the list
 * as a backlog. The default is STOP, so an omission means SHEDDABLE, and shedding this
 * job under memory pressure is correct rather than a gap: it is batch work with nobody
 * waiting, its output is a row nobody has been told about yet, and **the next pass's
 * overlap window covers everything a skipped pass would have written** — the whole
 * point of a cursor that reads back behind itself. `auth.login` and `auth.refresh`
 * already answer "an operator must be able to log in and fix the machine".
 *
 * It takes a NON-stoppable lease (`gate.acquire(NOTIFICATIONS_MATERIALIZE, false)`),
 * so the gate may refuse the pass but will not abort one in flight. Every pass is one
 * transaction over every source, which already makes it all-or-nothing; an abort
 * would only add a second mechanism for the same property, at the price of a partial
 * pass being representable at all.
 */
export const NOTIFICATIONS_MATERIALIZE: DispatchToken = 'notifications.materialize';

/**
 * `ConsentPurge` — the job that expires the consent records of erased people.
 *
 * ## Why it is NOT in `BREAKER_PROTECTED`
 *
 * The same argument `PURGE_ENQUEUER` makes, and for the same reason: this is batch
 * work with nobody waiting. It deletes rows that are already past their window, on a
 * window measured in DAYS, and a sweep that does not run today deletes them tomorrow
 * instead — there is no request blocked on the answer and no transaction left open.
 * Deferring it under memory pressure is therefore correct rather than a gap.
 *
 * ## Why the token exists at all
 *
 * The function it calls (`authz.purge_expired_consent_records`) is granted to
 * `app_admin` and to nobody else, and it was granted, and its window was required at
 * bootstrap, and **nothing called it** — so the consent record of every erased person
 * accumulated forever and the published retention policy did not happen. The token is
 * what makes this job a NAMED dispatch site rather than a function that exists: the
 * gate can name it, the scheduler can lock it, and the lock key is derived from it.
 */
export const CONSENT_PURGE: DispatchToken = 'consent.purge';

/**
 * `SecurityTelemetryFlush` — the job that turns what the request path recognised
 * into the four security-telemetry tables.
 *
 * ## Why it is NOT in `BREAKER_PROTECTED`
 *
 * The same argument `NOTIFICATIONS_MATERIALIZE` makes, and for the same reason:
 * this is batch work with nobody waiting. Its output is a row nobody has been
 * told about yet, and **the collector keeps the observations until the window
 * closes**, so a deferred flush loses nothing at all — the next pass writes the
 * same aggregate. It takes a NON-stoppable lease, so the gate may refuse the pass
 * but will not abort one in flight, and the pass is already one transaction over
 * four tables.
 *
 * ## Why the token exists at all
 *
 * The gate can name it, the scheduler can lock it, and the lock key is derived
 * from it — the same three things every other dispatch site has. A job with no
 * token is a job the gate cannot classify, and a site the gate cannot classify is
 * sheddable by accident rather than by decision.
 */
export const SECURITY_TELEMETRY_FLUSH: DispatchToken = 'security.telemetry.flush';

/**
 * The seven member-profile routes (`UsersController`), named so `RouteCensus` admits
 * them at boot.
 *
 * ## NOT IN `BREAKER_PROTECTED`, AND WHICH OF THE SEVEN THAT MATTERS
 *
 * The default is STOP, so an omission means **sheddable**, and for six of these seven
 * that is correct for the same reason the four token routes are sheddable: nothing is
 * half-done. A read, a name write and a history read are complete or not attempted; a
 * gated request did not happen and the member's next attempt works.
 *
 * The one that needs the argument is `users.confirm_email_change`. A gated confirm is
 * refused **before the handler runs**, so no token is consumed and the link is still
 * live when the member retries — which is exactly the property `auth.
 * password_reset_confirm` is sheddable on, and the reason it is not "a partially
 * applied address change".
 *
 * `users.change_password` and `users.create` are the two that would be worth
 * reconsidering if an operator ever needed to recover an account during a memory
 * crisis: neither is on the protected list, so under `red` both are sheddable and a
 * member cannot rotate a compromised password or an administrator cannot create the
 * account that the recovery needs. They are left off deliberately because the counter-
 * argument for the token routes — "an operator must be able to log in and fix the
 * machine" — is answered by `auth.login` and `auth.refresh` already being protected, and
 * adding two more permanently-exempt routes to buy a capability nobody has asked for is
 * the trade `auth.password_reset_confirm` explicitly rejects.
 */
export const USERS_ME: DispatchToken = 'users.me';
export const USERS_UPDATE_ME: DispatchToken = 'users.update_me';
export const USERS_REQUEST_EMAIL_CHANGE: DispatchToken = 'users.request_email_change';
export const USERS_CONFIRM_EMAIL_CHANGE: DispatchToken = 'users.confirm_email_change';
export const USERS_CHANGE_PASSWORD: DispatchToken = 'users.change_password';
export const USERS_LOGIN_ATTEMPTS: DispatchToken = 'users.login_attempts';
export const USERS_CREATE: DispatchToken = 'users.create';

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
 * ## This list is not a census, and the census is somewhere else
 *
 * An earlier version of this comment claimed that a route added without a line
 * here *fails the boot*. **Nothing implemented that**, and the claim was deleted
 * rather than left to be believed. It has since been implemented, in
 * `route-census.ts`: `RouteCensus` runs on `onApplicationBootstrap`, reads the
 * controllers Nest actually mounted through `DiscoveryService`, and throws
 * `RouteCensusError` naming every route this list does not cover.
 *
 * So the list below still is not a census — it is the vocabulary, and a
 * vocabulary is not a claim about the application. **The gate is separate and it
 * is mechanical**, which is what the deleted sentence was reaching for.
 *
 * What remains true, and is the part worth carrying forward: this tree has paid
 * for the omission in both directions, and both instances were invisible.
 * **The fixture direction:** `test/e2e/email.e2e-spec.ts` mounts
 * `EmailProbeController` into `AppModule`, so it really was an unnamed dispatch
 * site, and the cold-start window (`breaker-state.ts`) turned that from a
 * theoretical gap into a red test. It is now a declared exemption with a checked
 * reason rather than a silence. **The protection-list direction:** a typo in
 * `BREAKER_PROTECTED` is a site that is sheddable while the operator reads the
 * breaker reporting the crisis accurately — and that one is still caught only by
 * `breaker-environment.ts`, which refuses an unknown token at boot.
 *
 * **The honest limit, which no gate removes.** The census sees routes Nest
 * mounts. PostgREST is a separate process serving base tables
 * (`postgrest.conf:96-97`), so a CRUD table added there is a dispatch site no
 * amount of route-walking in this process can classify; the control that covers
 * it is §B2's, not this file's.
 */
export const KNOWN_DISPATCH_TOKENS: readonly DispatchToken[] = Object.freeze([
  AUTH_LOGIN,
  AUTH_REFRESH,
  AUTH_LOGOUT,
  AUTH_ME,
  AUTH_CAPTCHA,
  AUTH_PASSWORD_RESET_REQUEST,
  AUTH_PASSWORD_RESET_CONFIRM,
  AUTH_EMAIL_VERIFICATION_REQUEST,
  AUTH_EMAIL_VERIFICATION_CONFIRM,
  BREAKER_METER,
  BREAKER_GATE,
  PURGE_SWEEPER,
  PURGE_ENQUEUER,
  PRIVACY_ERASE,
  NOTIFICATIONS_MATERIALIZE,
  CONSENT_PURGE,
  SECURITY_TELEMETRY_FLUSH,
  USERS_ME,
  USERS_UPDATE_ME,
  USERS_REQUEST_EMAIL_CHANGE,
  USERS_CONFIRM_EMAIL_CHANGE,
  USERS_CHANGE_PASSWORD,
  USERS_LOGIN_ATTEMPTS,
  USERS_CREATE,
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
 * **The complement of that is now checked, and what it does not cover.**
 * `RouteCensus` (`route-census.ts`) walks the mounted controllers on every boot
 * and refuses one this function would leave `undefined` — so an unnamed route no
 * longer survives to the first memory crisis, it stops the process at startup.
 * With the shipped `BREAKER_PROTECTED` the whole thin-app surface is named, so
 * the interceptor's refusal branch still has no runtime exercise: the control
 * that keeps it honest is the boot, not the tests.
 */
export function dispatchTokenForRoute(controllerName: string, handlerName: string): DispatchToken | undefined {
  const service = controllerName.replace(/Controller$/, '').toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(service)) {
    return undefined;
  }
  const candidate = `${service}.${handlerName}`;
  return KNOWN_DISPATCH_TOKENS.includes(candidate) ? candidate : undefined;
}