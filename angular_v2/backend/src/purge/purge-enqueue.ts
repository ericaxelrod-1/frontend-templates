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
 *     would read **zero** rows. Measured on this schema: a definer function
 *     reading `users` returns 0 against a table holding 1 row; `app_admin`
 *     returns 1. The same measurement is why `authz.record_user_activity()` is
 *     INVOKER (`0017` §4).
 *   * No serving role holds `INSERT` on `privacy_purge_queue` — deliberately, and
 *     `test/rls/privacy-purge-queue.spec.ts` asserts the refusal per role. The
 *     insert has to happen as the owner, through `authz`.
 *
 * So both scan functions are `SECURITY INVOKER` and run as `app_admin` — the
 * superset principal, for which `users_read_scope` deliberately keeps the admin
 * branch first so these scans can see every population (`0009:214-226`) — and
 * `authz.enqueue_inactive_purges()` is `SECURITY DEFINER` and runs as the owner.
 * All three are granted to `app_admin` alone (`0016`, `0017` §7).
 *
 * ## Why ONE scan statement covers TWO populations, and why the reasons are literals
 *
 * `SELECT_DUE_PURGES_SQL` is one statement over two functions, and the reason code
 * is written **in the SQL, not supplied by the caller**. `authz.enqueue_inactive_purges`
 * takes one array per population and names the code for each in its own body
 * (`0017` §6), so:
 *
 *   * a caller cannot label a live account `inactivity_purge`, which is the defect
 *     a `text` reason argument would invite — an operator filtering on the
 *     tombstone code would be looking at a person;
 *   * one transaction still covers both populations, so the operator's single
 *     filterable list is filled in one atomic act or not at all.
 *
 * The rejected alternative — one function taking both windows — was rejected for a
 * sharper reason: `0017` puts a **different floor on each window**, and a single
 * function with two arguments cannot say which key it is refusing. Two functions,
 * two floors, two messages naming their own argument.
 */

/**
 * Which rows are DUE, across both populations.
 *
 * `ORDER BY due_since, user_id` so two sweeps over the same set take the same order
 * and the enqueue that follows is reproducible. The `(deleted_at)` partial index
 * from `0009` serves the tombstone half and `(last_activity_at, id)` from `0017`
 * serves the account half, so each scan touches its own population and not the
 * whole table.
 *
 * **The two populations cannot overlap**: `retention_due_tombstones` requires
 * `deleted_at IS NOT NULL` and `retention_due_accounts` requires
 * `deleted_at IS NULL`. An account soft-deleted today is purged on the tombstone
 * clock from today, never re-aged from whenever it last logged in.
 *
 * Both functions refuse a window below its own floor with `22023` — 1825 days for
 * tombstones, 1095 for accounts — so a value below the floor fails with a message
 * naming the argument rather than deleting everybody on a `1`.
 */
export const SELECT_DUE_PURGES_SQL = `
SELECT due.user_id, due.reason
  FROM (
    SELECT tombstone.user_id, 'inactivity_purge'::text AS reason, tombstone.deleted_at AS due_since
      FROM authz.retention_due_tombstones($1::integer) AS tombstone
    UNION ALL
    SELECT account.user_id, 'inactive_account_purge'::text AS reason, account.last_activity_at AS due_since
      FROM authz.retention_due_accounts($2::integer) AS account
  ) AS due
 ORDER BY due.due_since, due.user_id
`;

/**
 * The enqueue, and the only INSERT into the queue in this tree.
 *
 * The whole set goes in one statement so a sweep is one atomic act: a queue row
 * exists for every due row or for none of them, and there is no window in which a
 * half-finished sweep has left the admin list describing work that is not
 * scheduled.
 *
 * **Two arrays, one per population, because the reason is a literal in SQL.**
 * `enqueue_inactive_purges(uuid[], uuid[])` writes `inactivity_purge` for the
 * first and `inactive_account_purge` for the second, and the caller names no
 * reason at all. `$1` is `RETENTION_TOMBSTONE_DAYS`, `$2` is
 * `RETENTION_INACTIVE_ACCOUNT_DAYS`.
 *
 * The double-sweep guard is the partial UNIQUE index from `0011`, not anything
 * here: `ON CONFLICT DO NOTHING` is only the polite way to be quiet about a
 * target that already has an open purge. That row will be claimed, executed and
 * recorded; a second row for the same target would be claimed, delete nothing,
 * write `rows_deleted = 0` and read in the admin view as a successful purge.
 */
export const ENQUEUE_INACTIVE_PURGES_SQL = `
SELECT authz.enqueue_inactive_purges($1::uuid[], $2::uuid[])
`;

/** One row of the combined scan: a due target, and which population it belongs to. */
export type DuePurge = {
  readonly user_id: string;
  /** `inactivity_purge` (a tombstone) or `inactive_account_purge` (a live account). */
  readonly reason: string;
};

/**
 * The two populations, as the enqueue takes them.
 *
 * Split here rather than in SQL because the split is the one place the operator's
 * filter is decided by the application — and it is decided by **sorting on a value
 * the database returned**, never by inferring a reason from the shape of a row. A
 * row whose `reason` is neither of the two known codes is a bug, so it is raised
 * on here (§2.3) rather than dropped: a silently dropped due row is an account that
 * is never purged and nobody finds out.
 */
export type DuePopulations = {
  /** Tombstones, to be written as `inactivity_purge`. */
  readonly tombstoneIds: readonly string[];
  /** Dormant live accounts, to be written as `inactive_account_purge`. */
  readonly inactiveAccountIds: readonly string[];
};

/** The reason codes the database writes, spelled once. */
export const TOMBSTONE_REASON = 'inactivity_purge';
export const INACTIVE_ACCOUNT_REASON = 'inactive_account_purge';

export function splitByPopulation(rows: readonly DuePurge[]): DuePopulations {
  const tombstoneIds: string[] = [];
  const inactiveAccountIds: string[] = [];

  for (const row of rows) {
    if (row.reason === TOMBSTONE_REASON) {
      tombstoneIds.push(row.user_id);
    } else if (row.reason === INACTIVE_ACCOUNT_REASON) {
      inactiveAccountIds.push(row.user_id);
    } else {
      throw new Error(
        `the retention scan returned reason '${row.reason}' for user ${row.user_id}, which is neither ` +
          `'${TOMBSTONE_REASON}' nor '${INACTIVE_ACCOUNT_REASON}'. The queue's reason domain and the scan ` +
          'have diverged; refusing to guess which population this row belongs to.',
      );
    }
  }

  return { tombstoneIds, inactiveAccountIds };
}

/** What one sweep did. Counted, never inferred. */
export type EnqueueSummary = {
  /** Rows the scan found due, across both populations. */
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