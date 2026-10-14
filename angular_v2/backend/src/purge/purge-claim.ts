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
 * This statement cannot reproduce that: the sub-select takes the row locks and
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
 */
export const CLAIM_DUE_PURGE_SQL = `
UPDATE privacy_purge_queue AS q
   SET status       = 'claimed',
       claimed_at   = now(),
       claimed_by   = $1,
       attempt      = q.attempt + 1
  FROM (
        SELECT id
          FROM privacy_purge_queue
         WHERE status = 'pending'
           AND scheduled_for <= now()
         ORDER BY scheduled_for, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       ) AS due
 WHERE q.id = due.id
RETURNING q.id,
          q.target_kind,
          q.target_id,
          q.target_ref,
          q.reason,
          q.attempt
`;

/**
 * Marking the row finished, **with the ownership predicate**.
 *
 * Not `WHERE id = $1`. The legacy re-read by primary key alone and would happily
 * write to a row another sweeper had since taken; `status = 'claimed' AND
 * claimed_by = $instance` is the predicate that makes a write safe when there are
 * N sweepers, and it is the same predicate every read after the claim carries.
 *
 * Zero rows affected is not an error here — it means this sweeper no longer owns
 * the row (reclaimed, cancelled, or completed), and reporting success on it would
 * be §2.3's success-shaped value for work that did not happen. `sweepOne` throws
 * instead.
 */
export const COMPLETE_PURGE_SQL = `
UPDATE privacy_purge_queue
   SET status       = 'done',
       completed_at = now(),
       rows_deleted = $3,
       error        = NULL
 WHERE id = $1
   AND status = 'claimed'
   AND claimed_by = $2
`;

/**
 * The poison pill. Terminal, keeps its `error`, and stays visible to an operator.
 *
 * **It runs INSIDE the claim's transaction**, immediately after
 * `ROLLBACK TO SAVEPOINT` — which is what makes its ownership predicate match at
 * all. See `PURGE_WORK_SAVEPOINT`: the alternative (roll the whole transaction
 * back and then write the failure) un-does the claim along with the delete, so the
 * row is `pending` with `claimed_by = NULL` again and this `UPDATE` matches zero
 * rows — the failure is recorded nowhere, `attempt` never advances, the row is
 * retried forever, and `RETENTION_PURGE_MAX_ATTEMPTS` is unreachable code.
 *
 * See `REQUEUE_PURGE_SQL`, which is this statement minus the terminal status.
 */
export const FAIL_PURGE_SQL = `
UPDATE privacy_purge_queue
   SET status = 'failed',
       error  = $3
 WHERE id = $1
   AND status = 'claimed'
   AND claimed_by = $2
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
UPDATE privacy_purge_queue
   SET status     = 'pending',
       claimed_at = NULL,
       claimed_by = NULL,
       error      = $3
 WHERE id = $1
   AND status = 'claimed'
   AND claimed_by = $2
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
