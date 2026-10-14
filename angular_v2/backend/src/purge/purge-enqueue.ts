/**
 * The retention scan's two statements, and the shape of what one sweep returns.
 *
 * ## Why these are two statements and not one
 *
 * The scan reads `users` and writes `privacy_purge_queue`, and **no single
 * identity can do both** — which is a property of the schema rather than a choice,
 * and `0016` records the measurement:
 *
 *   * `public.users` is FORCE ROW LEVEL SECURITY (`0008:326`), so the table OWNER
 *     is bound by `users_read_scope` (`0009:229-241`), whose branches are
 *     `current_user = 'app_admin'` and "my own, undeleted row". Inside a
 *     `SECURITY DEFINER` function `current_user` IS the owner, so a definer scan
 *     would read **zero** tombstones. Measured on this schema: a definer function
 *     reading `users` returns 0 against a table holding 1 row; `app_admin`
 *     returns 1.
 *   * No serving role holds `INSERT` on `privacy_purge_queue` — deliberately, and
 *     `test/rls/privacy-purge-queue.spec.ts` asserts the refusal per role. The
 *     insert has to happen as the owner, through `authz`.
 *
 * So `authz.retention_due_tombstones()` is `SECURITY INVOKER` and runs as
 * `app_admin` — the superset principal, for which `users_read_scope` deliberately
 * keeps the admin branch first so this scan can see tombstones
 * (`0009:214-226`) — and `authz.enqueue_inactive_purges()` is `SECURITY DEFINER`
 * and runs as the owner. Both are granted to `app_admin` alone (`0016`).
 *
 * ## The window is an argument, and it has no default here either
 *
 * `$1` is `RETENTION_TOMBSTONE_DAYS`, validated at boot by
 * `src/purge/retention-environment.ts` and validated again inside the function,
 * which raises `22023` outside 1..36500. The window appears in exactly two places
 * — the bound value and the SQL — and nowhere as a literal.
 */

/**
 * Which tombstones are DUE.
 *
 * `ORDER BY deleted_at, id` so two sweeps over the same set take the same order
 * and the enqueue that follows is reproducible; the `(deleted_at)` partial index
 * from `0009` serves the predicate, so the scan touches the tombstones and not
 * the live table.
 *
 * `authz.retention_due_tombstones()` refuses a window outside 1..36500, so a
 * nonsensical value fails with a message naming the argument rather than
 * deleting everybody on a zero.
 */
export const SELECT_DUE_TOMBSTONES_SQL = `
SELECT due.user_id
  FROM authz.retention_due_tombstones($1::integer) AS due
`;

/**
 * The enqueue, and the only INSERT into the queue in this tree.
 *
 * The whole set goes in one statement so a sweep is one atomic act: a queue row
 * exists for every due tombstone or for none of them, and there is no window in
 * which a half-finished sweep has left the admin list describing work that is not
 * scheduled.
 *
 * `reason = 'inactivity_purge'` for every tombstone, anonymised or not. `0011`
 * makes anonymisation a STATUS rather than a second population — the two differ
 * by one boolean (`users.email_anonymized`) — so there is one reason code, one
 * candidate query and one admin list.
 *
 * The double-sweep guard is the partial UNIQUE index from `0011`, not anything
 * here: `ON CONFLICT DO NOTHING` is only the polite way to be quiet about a
 * target that already has an open purge. That row will be claimed, executed and
 * recorded; a second row for the same target would be claimed, delete nothing,
 * write `rows_deleted = 0` and read in the admin view as a successful purge.
 */
export const ENQUEUE_INACTIVE_PURGES_SQL = `
SELECT authz.enqueue_inactive_purges($1::uuid[])
`;

/** One row of `authz.retention_due_tombstones()`. */
export type DueTombstone = {
  readonly user_id: string;
};

/** What one sweep did. Counted, never inferred. */
export type EnqueueSummary = {
  /** Tombstones the scan found due. */
  readonly scanned: number;
  /** Queue rows the enqueue actually created. Committed rows, always. */
  readonly enqueued: number;
  /**
   * `gated` — the breaker refused the sweep; nothing was scanned and nothing was
   * written. `aborted` — the sweep was **stopped in flight** after it had already
   * scanned; the transaction was rolled back, so the queue is exactly as it was.
   *
   * `aborted` is a separate value rather than a `gated` with a non-zero `scanned`
   * because the two are different facts for an operator: one says the machine
   * never let the job start, the other says it let the job start and then took it
   * back. Collapsing them would hide the second, which is the one worth noticing.
   */
  readonly outcome: 'enqueued' | 'nothing_due' | 'gated' | 'aborted';
};
