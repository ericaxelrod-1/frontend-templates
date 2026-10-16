import type { PoolClient } from 'pg';

/**
 * WHERE "ACTIVITY" COMES FROM, WHAT IT DELIBERATELY DOES NOT SEE, AND WHY THE
 * ALTERNATIVES WERE REJECTED
 *
 * ## THE ARCHITECTURAL TRAP, STATED BEFORE THE ANSWER
 *
 * "Update `users.last_activity_at` on every authenticated request" is not
 * achievable in this architecture, and the reason is not a missing feature:
 *
*   * **PostgREST is the API layer.** It serves the CRUD surface directly out of
 *     PostgreSQL (`AGENTS.md` §B1: "PostgREST serves base tables. It is the
 *     API layer"). Nest sees a handful of routes — the session ones
 *     (`login`, `refresh`, `logout`, `me`) and the four one-time-token ones. Every
 *     read and every write that is not one of those never passes through this
 *     process, so no code here can observe it. A middleware that stamped the column
 *     would stamp it on a few endpoints out of the entire API.
 *   * **`db-pre-request` cannot write.** `AGENTS.md` §B6 records that it runs in a
 *     **read-only transaction**, so a write there fails `25006` and a working
 *     request returns `405`. It is also the hook this schema reserves for
 *     **revocation**, and §B2 F1 makes any `pg` client or hook that can reach the
 *     claims GUC a **P0**. So "just add a hook" is not a smaller version of the
 *     answer; it is a new trust boundary on the one setting the whole scope axis
 *     is keyed on.
 *
 * So the choice is not "how do we record every request" — it is **which activity
 * do we measure, and what does that choice miss.**
 *
 * ## THE DEFINITION THIS TREE RECORDS, IN ONE SENTENCE
 *
 * **Activity is a successful re-authentication: a login, a refresh, a logout, or
 * a password reset.** Every one of those is a transaction this process has
 * *already opened* to do something else, so recording activity costs **no
 * additional round trip** — one indexed `UPDATE` rides inside a transaction that
 * is already committing.
 *
 * A password reset is the strongest of the four and the reason it belongs here: the
 * user proved control of a mailbox, which is better evidence than a password, and
 * an account that resets and never returns is precisely the population the dormant
 * purge is for. Its `UPDATE` rides in the transaction that changes the password and
 * revokes the sessions.
 *
 * The one-time-token **request** routes are deliberately absent, and they are the
 * clearest available answer to "why not every route": a request may name a mailbox
 * that does not exist, so stamping activity for one would let anyone keep an account
 * alive by asking for its reset link — the exact defect described under the
 * alternatives below, in a place where it would be hardest to notice.
 *
 * ## WHY THESE FOUR AND NOT A FIFTH (`GET /auth/me`)
 *
 * `me` is the only authenticated route in the thin app that is a **pure read**,
 * and it is excluded on purpose. Recording on it turns a read into a write: a
 * client that polls `/auth/me` — which is what a frontend does on every route
 * change — would double the database's write rate on `users` to record something
 * the refresh 30 seconds later records anyway, because a client holding a valid
 * access token has, by definition, refreshed recently. The event being measured
 * here is *re-authentication*, and `me` is not one.
 *
 * ## WHAT THIS MISSES — THE GAP IS REAL, IT IS NOT ZERO, AND IT IS BOUNDED
 *
 * A request carrying a **still-valid access token** writes nothing. That is the
 * whole of the gap, and it is worth being precise about what it does and does not
 * cost:
 *
 *   * **It does NOT hide a user who reads through PostgREST and never
 *     re-authenticates** — that case is narrower than it looks, because an access
 *     token is short-lived (`ACCESS_TOKEN_TTL_SECONDS`, 900 s by default, §B5: "Access
 *     tokens short-lived (~15–30 min)"). A user reading continuously must refresh
 *     when it expires, and the refresh is an observation. **Their activity is
 *     attributed to the instant of the most recent re-authentication**, so a
 *     session's usage is recorded with a lag of at most one access-token lifetime.
 *   * **It DOES miss** a reader who never refreshes: a scripted consumer holding a
 *     single long-lived token, a client that caches its access token past expiry,
 *     or a stolen refresh token in constant use. No re-authentication means no
 *     observation, and such an account ages into the dormant population while it is
 *     being used. There is no hook that closes this without a write per request or
 *     a new trust boundary on `db-pre-request`/`db-post-request`.
 *   * **It says nothing about database activity.** A row read ten thousand times
 *     through PostgREST on one valid token is indistinguishable from a row nobody
 *     touched. **This template measures authentication activity, not usage.**
 *     `docs/rebase.md` §9A.6's better anchor — `MAX(created_at)` over a table of a
 *     user's own actions — is still only a proposal, because that table does not
 *     exist in this tree and inventing one is a tenant payload with an unbounded
 *     store.
 *
 * The operational consequence, stated so it is found here rather than later: **a
 * `RETENTION_INACTIVE_ACCOUNT_DAYS` that is close to the access-token lifetime is
 * wrong for a deployment with long-lived consumers**, and the number that is safe
 * (1095 days, three years — `retention-environment.ts`) is chosen so that the gap
 * cannot reach it in any realistic session pattern.
 *
 * ## THE TWO CHEAPER ALTERNATIVES, AND WHY NEITHER IS THIS
 *
 *   * **Derive it from something already written** — refresh-token rotation, or
 *     `login_attempts`. Both are recorded inside transactions this process already
 *     opens, so they cost nothing extra… and both are the wrong signal. A refresh
 *     token row is **revoked** on logout rather than deleted, so "the newest token
 *     row" reads a session that ended as the most recent activity, which is the
 *     opposite of what a dormant account looks like. And `login_attempts` records
 *     **attempts**, not successes: an attacker hammering a dormant account's name
 *     would keep it looking alive, which turns a retention mechanism into a DoS
 *     against the retention decision itself. Activity must mean *authenticated*
 *     activity.
 *   * **A `db-post-request` write.** The only route that genuinely covers CRUD. It
 *     costs **one write per request** — on the busiest table in the schema — and it
 *     adds a new place where a GUC is read. §B2 F1: `request.jwt.claims` is
 *     **caller-writable**, so a post-request hook keyed on it would be a P0 standing
 *     where the current invariant is an *absence*. Trading a bounded, documented
 *     observation gap for a write on every read and a new caller-writable surface is
 *     a bad trade, and it is recorded here so the next reader knows it was
 *     considered rather than missed.
 *
 * ## WHAT THIS PRODUCER IS NOT
 *
 * It is **not** an erasure path and not part of one. `users.last_activity_at` ages
 * a LIVE account out of a template that nobody is using; a deletion request is a
 * legal obligation with a compliance record, and there is none in this tree. The
 * purge that reads this column deletes the row; nothing here ever anonymises one.
 */

/**
 * The one statement that records activity.
 *
 * **`authz.record_user_activity()`, never an inline `UPDATE`.** Three reasons, all
 * of which the statement text itself cannot carry:
 *
 *   * the timestamp is **not the caller's** — the function calls `now()` itself, so
 *     no request handler can write `'-infinity'` (accelerating its own destruction)
 *     or `'infinity'` (making itself immortal);
 *   * the write has a **name**, so "who may write this column" is one line in the
 *     catalog rather than three call sites that drift;
 *   * `EXECUTE` is revoked from `PUBLIC` and granted to `app_admin` alone, so the
 *     seam is narrow even though `app_admin` could have written the column anyway.
 *
 * `$1` is BOUND, so a user id cannot become syntax.
 */
export const RECORD_ACTIVITY_SQL = `SELECT authz.record_user_activity($1::uuid)`;

/**
 * Records one observation, inside a transaction the caller has already opened.
 *
 * Returns the function's own boolean — whether a row was actually stamped — rather
 * than `rowCount`, which `pg` reports as 1 for a `SELECT` whether or not anything
 * was written, and which is therefore the §2.3 success-shaped value in its purest
 * form.
 *
 * **The single `false` answer is not an error and is not handled as one.** It is an
 * account that was soft-deleted concurrently with its own login: there was no
 * un-deleted row to stamp, and failing that request would convert a benign race
 * into a 500 on the login path for a row nobody is going to keep. Nothing is
 * logged about it — there is nothing to say, and an error path that fires on a
 * condition the caller cannot act on is noise dressed as a check.
 */
export async function recordActivity(client: PoolClient, userId: string): Promise<boolean> {
  const result = await client.query<{ record_user_activity: boolean }>(RECORD_ACTIVITY_SQL, [userId]);
  const recorded = result.rows[0]?.record_user_activity;
  if (typeof recorded !== 'boolean') {
    throw new Error(
      `authz.record_user_activity did not return a boolean for user ${userId}; ` +
        'returning a guess here would put a success-shaped value on a column that decides destruction.',
    );
  }
  return recorded;
}