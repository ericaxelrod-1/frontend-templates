/**
 * One row of `privacy_purge_queue`, as the sweeper sees it.
 *
 * The table is created by migration `0011_privacy_purge_queue` (owned by another
 * change); the columns this file names are exactly the ones the sweeper's two
 * statements read, and
 * nothing here is inferred. `claimed_by` is load-bearing rather than decorative:
 * it is the ownership key, and the legacy's queue had no owner column at all, so
 * two sweepers were indistinguishable and no read could predicate on ownership
 * even when it wanted to.
 */
export type PurgeClaim = {
  readonly id: string;
  readonly targetKind: 'user' | 'table' | 'file';
  readonly targetId: string | null;
  readonly targetRef: string | null;
  readonly reason: string;
  readonly attempt: number;
};

/**
 * The claim: **one statement**, so select and lock cannot disagree.
 *
 * `SELECT … FOR UPDATE SKIP LOCKED` followed by a separate `UPDATE` is the defect
 * the legacy is cited for twice over — its claim was an atomic conditional
 * `UPDATE`, but the read that followed it was unguarded (by primary key, with no
 * status predicate and no ownership predicate), so a sweeper whose row had been
 * reclaimed by the stale-job monitor would re-read a row that was no longer the
 * row it claimed and process it too. Two erasures from one request.
 *
 * The statement cannot reproduce that: the sub-select takes the row locks and
 * the outer `UPDATE` marks the very rows that sub-select returned, in one
 * statement, so there is no interval in which a row is locked but unmarked, and
 * no follow-up read at all. `SKIP LOCKED` is also what removes the need for a
 * leader: N instances, one queue, no election, no advisory lock.
 *
 * `LIMIT 1`, not a batch. The sweeper runs **one transaction per purge**, so
 * claim, delete and mark-done are the same transaction and there is no window in
 * which a row can be stranded in `claimed` with nothing to reclaim it — which is
 * precisely why this design has no `locked_at` and no staleness monitor to be
 * wrong.
 *
 * The caller must already be inside a transaction; a claim outside one would
 * commit the moment the implicit transaction ended and reintroduced the stranded
 * window this exists to remove.
 *
 * =============================================================================
 * WHY THIS IS A CALL AND NOT THE `UPDATE` — migration `0016`, and the two routes
 * that were closed rather than chosen
 * =============================================================================
 * This used to be the bare `UPDATE` above, and it matched **zero rows in
 * production**: `PurgeSweeper.sweepOne()` runs it with no
 * `request.jwt.claims` in scope, the inner `SELECT` is a plain `SELECT` on
 * `privacy_purge_queue`, and `privacy_purge_read` is `authz.can_read_privacy_purge()`
 * ALONE — no `current_user` shortcut, by the deliberate decision recorded at
 * `0011:383-388`. `authz.actor()` is NULL inside the sweeper, so
 * `has_permission(NULL, …)` is false and the sub-select was empty. Measured on
 * this schema, no claims document in scope: `UPDATE 0`.
 *
 * So the claim is now `authz.claim_due_purge()`, a `SECURITY DEFINER` function in
 * `authz` granted to `app_admin` alone (`0016`). It carries the statement above
 * verbatim — one statement, `SKIP LOCKED`, `LIMIT 1`, the same tie-break — and
 * runs it as the table's owner, which is the only identity whose read of the
 * queue is not filtered by a policy written for a human holding a token.
 *
 * Two alternatives were closed, and neither of them is reopened here:
 *
 *   * **A `current_user = 'app_admin'` branch on `privacy_purge_read`** contradicts
 *     the shipped, tested rule that capability resolves from ROLE ROWS and never
 *     from the database role, and `privacy-purge-queue.spec.ts` asserts against
 *     it.
 *   * **Giving the sweeper a claims document** is `AGENTS.md` §B2 F1: that GUC is
 *     a custom setting ANY ROLE MAY `SET`, verified exploitable, and the whole
 *     mitigation is architectural — no request-reachable SQL path may write it. A
 *     scheduled job that writes its own claims document is that path, promoted to
 *     a standing P0 so a cron entry can drain a queue. Nothing in `src/` sets it,
 *     and nothing in this tree's tests sets it either.
 *
 * `0016` also revokes `UPDATE` on `privacy_purge_queue` from `app_admin`, so the
 * bare statement is no longer executable by anyone: a claim written inline fails
 * with `permission denied for table` and names itself, instead of matching zero
 * rows and reading as an empty queue.
 */
export const CLAIM_DUE_PURGE_SQL = `
SELECT *
  FROM authz.claim_due_purge($1) AS q
`;

/**
 * Marking the row finished, **with the ownership predicate**.
 *
 * Not `WHERE id = $1`. The legacy re-read by primary key alone and would happily
 * write to a row another sweeper had since taken; `status = 'claimed' AND
 * claimed_by = $instance` is the predicate that makes a write safe when there are
 * N sweepers, and it is the same predicate every read after the claim carries.
 *
 * The statement lives in `authz.complete_purge()` (`0016`) for the reason
 * `CLAIM_DUE_PURGE_SQL` names, and the function returns **the number of rows it
 * matched** rather than nothing.
 *
 * Zero rows affected is not an error here — it means this sweeper no longer owns
 * the row (reclaimed, cancelled, or completed), and reporting success on it would
 * be §2.3's success-shaped value for work that did not happen. `sweepOne` throws
 * instead, and it can only tell the two apart because the return value is the
 * count: a `void` function would make "matched nothing" and "succeeded" the same
 * value.
 */
export const COMPLETE_PURGE_SQL = `
SELECT authz.complete_purge($1, $2, $3::integer)
`;

/**
 * The poison pill. Terminal, keeps its `error`, and stays visible to an operator.
 *
 * **It runs INSIDE the claim's transaction**, immediately after
 * `ROLLBACK TO SAVEPOINT` — which is what makes its ownership predicate match at
 * all. See `PURGE_WORK_SAVEPOINT`: the alternative (roll the whole transaction
 * back and then write the failure) un-does the claim along with the delete, so the
 * row is `pending` with `claimed_by = NULL` again and this write matches zero
 * rows — the failure is recorded nowhere, `attempt` never advances, the row is
 * retried forever, and `RETENTION_PURGE_MAX_ATTEMPTS` is unreachable code.
 *
 * See `REQUEUE_PURGE_SQL`, which is this statement minus the terminal status.
 */
export const FAIL_PURGE_SQL = `
SELECT authz.fail_purge($1, $2, $3)
`;

/**
 * Below the attempt limit: the row goes back to `pending` with its error KEPT.
 *
 * The same ownership predicate as `COMPLETE_PURGE_SQL` and `FAIL_PURGE_SQL`, for
 * the same reason: with N sweepers, a write without `claimed_by = $2` can land on a
 * row another instance has since taken. Clearing `claimed_at` matters for the same
 * reason there is no `locked_at`: the claim is not a lease with an expiry, it is a
 * marker inside the transaction that does the work.
 *
 * Both statements live here rather than inline in the sweeper so there is exactly
 * one text per operation — a duplicated `WHERE` clause is where the legacy's
 * unguarded re-read came from.
 */
export const REQUEUE_PURGE_SQL = `
SELECT authz.requeue_purge($1, $2, $3)
`;

/**
 * The savepoint that separates "the delete" from "the rest of the purge".
 *
 * **This is what keeps one transaction per purge while still recording a failure.**
 * A `DELETE` that raises leaves the transaction in the aborted state, so the only
 * way to write the failure row afterwards is to unwind to a savepoint taken
 * *before* the delete. Unwinding to one undoes the deletion alone; the claim
 * (`status = 'claimed'`, `attempt + 1`, `claimed_by`) survives inside the same
 * transaction, so `FAIL_PURGE_SQL` / `REQUEUE_PURGE_SQL` still match on ownership,
 * and the row leaves this transaction in `pending` or `failed` — never in
 * `claimed`.
 *
 * Rolling the WHOLE transaction back instead is not a simpler spelling of the same
 * thing; it is a different outcome, and the wrong one: it restores the row to
 * `pending` with its attempt counter rewound, so a delete that always fails is
 * retried forever and the attempt limit can never be reached. That is the
 * unbounded retry loop `RETENTION_PURGE_MAX_ATTEMPTS` exists to prevent.
 *
 * **What still rolls the whole transaction back is an ABORT.** If the transaction
 * is aborted (the gate's STOP, a dropped connection, a process death), the claim
 * goes with the delete and nothing is left claimed — which is the "aborting leaves
 * no partial state" criterion, and it is why a partial purge is not representable.
 */
export const PURGE_WORK_SAVEPOINT = 'SAVEPOINT purge_work';
export const ROLLBACK_TO_PURGE_WORK = 'ROLLBACK TO SAVEPOINT purge_work';
export const RELEASE_PURGE_WORK = 'RELEASE SAVEPOINT purge_work';

/**
 * The fields of a claimed queue row this build reads.
 *
 * `authz.claim_due_purge()` returns `SETOF public.privacy_purge_queue`, so the row
 * carries every column the queue has; this names the six the sweeper acts on, and
 * `toPurgeClaim` copies exactly those. The extra columns are the queue's own
 * record — `error`, `completed_at`, `rows_deleted` — and reading them into the
 * claim would put an operator's failure text into the object the executor
 * dispatches on.
 */
export type PurgeClaimRow = {
  readonly id: string;
  readonly target_kind: string;
  readonly target_id: string | null;
  readonly target_ref: string | null;
  readonly reason: string;
  readonly attempt: number;
};

/**
 * Narrow a database row to the closed set, or refuse it.
 *
 * A `target_kind` this build does not implement becomes `undefined` rather than
 * being passed through, so no downstream `switch` can acquire a default branch and
 * start treating an unknown target as something it is not.
 */
export function toPurgeClaim(row: PurgeClaimRow): PurgeClaim | undefined {
  if (row.target_kind !== 'user' && row.target_kind !== 'table' && row.target_kind !== 'file') {
    return undefined;
  }
  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    targetRef: row.target_ref,
    reason: row.reason,
    attempt: row.attempt,
  };
}

/**
 * The number of rows a `COMPLETE` / `FAIL` / `REQUEUE` write matched.
 *
 * Those three are calls into `authz.complete_purge()` and its two siblings
 * (`0016`), and each returns the count rather than nothing. **`rowCount` cannot be
 * used for them**: `pg` reports one row for a `SELECT` whether or not the
 * function found anything, so a write that matched nothing and a write that
 * matched the one row this sweeper owns are the same `rowCount` of 1.
 *
 * That distinction is the whole N-sweeper contract — `claimed_by` is what makes a
 * write safe, and "matched zero rows" is what says this sweeper no longer owns
 * the row — so the returned value is read, and a shape this function cannot
 * understand is an error rather than a number it invents. Defaulting an
 * unrecognised answer to `0` would be the worst available choice: `0` here means
 * "you no longer own the row", and a driver that changed its wire format would
 * quietly turn every successful purge into a thrown error.
 *
 * A scalar function's column arrives named after the function — `pg` hands back
 * `{ complete_purge: 1 }` — so a single-column row is unwrapped rather than
 * guessed at by key. Two columns would mean two answers to "how many rows", and
 * the shape is refused instead.
 */
export function writtenRows(result: { readonly rows: readonly unknown[] }): number {
  const value = unwrapSingleValue(result.rows[0]);
  if (typeof value === 'number') {
    return value;
  }
  // `int4` arrives as a number over the wire; a text-returning driver
  // configuration delivers the same count as a digit string, so both are read and
  // nothing else is.
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  throw new Error(
    `a purge write returned ${JSON.stringify(value ?? null)} instead of the number of rows it matched`,
  );
}

/** The value of a one-column row, or `undefined` for anything else. */
function unwrapSingleValue(row: unknown): unknown {
  if (typeof row === 'number' || typeof row === 'string') {
    return row;
  }
  if (typeof row === 'object' && row !== null) {
    const values = Object.values(row);
    if (values.length === 1) {
      return values[0];
    }
  }
  return undefined;
}
