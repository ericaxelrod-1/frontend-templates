import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { PurgeClaim } from './purge-claim.js';

/**
 * Raised for a queued purge this build cannot execute.
 *
 * **It raises; it never returns zero.** Returning `0` for a reason that was not
 * executed writes `rows_deleted = 0`, which an operator reads in the admin view
 * as "we deleted a row and it was already gone" — a success-shaped value for work
 * that did not happen, which is §2.3's defect wearing a number. The sweeper turns
 * this into a `failed` queue row with the message attached, which is visible,
 * attributable and countable.
 */
export class UnsupportedPurgeReasonError extends Error {
  constructor(reason: string, targetKind: string) {
    super(
      `refusing to purge reason '${reason}' on a '${targetKind}' target: this build has no executor for it. ` +
        'Silently reporting rows_deleted = 0 would record a deletion that did not happen.',
    );
    this.name = 'UnsupportedPurgeReasonError';
  }
}

/**
 * The DI token for the executor port. A TypeScript interface cannot be an
 * injection token, so the interface and the token that carries it are created
 * together and only ever bound once — in `purge.module.ts`, to `SqlPurgeExecutor`.
 */
export const PURGE_EXECUTOR = 'PURGE_EXECUTOR';

/**
 * The port. One mechanism per concern (`AGENTS.md` §2.4): the sweeper decides
 * *whether* to run, this decides *what running means*.
 *
 * It is a port rather than a concrete class so the reason table is data in one
 * place, and it is **not** a stand-in: the only implementation is
 * `SqlPurgeExecutor`, registered once, and there is no factory that could be
 * swapped for a fake outside a test file.
 */
export type PurgeExecutor = {
  /**
   * Executes one purge inside the caller's transaction and returns the number of
   * rows it actually removed.
   *
   * `rows_deleted` is a **return value, never an estimate**: an operator can
   * recompute the expected figure with the same predicate and compare. The claim
   * bounds and the delete bounds are the same predicate, which is what makes "a
   * purge scheduled for user X deletes exactly user X's row and no other user's
   * row" checkable rather than asserted.
   */
  execute(client: PoolClient, claim: PurgeClaim): Promise<number>;
};

/**
 * The only executor.
 *
 * **The dispatch is CLOSED.** An unrecognised reason raises rather than falling
 * through to a no-op, because a caller that reaches a reason this table does not
 * implement has found a bug, and returning success there is exactly the defect
 * §2.3 exists to prevent.
 *
 * ## What is implemented, and what is not, stated rather than implied
 *
 * `inactivity_purge` is implemented: it deletes one `users` row, identified by the
 * queue row's `target_id`. The queue row carries **no foreign key to `users`**,
 * and that is load-bearing rather than incidental — the queue row must outlive its
 * target, so an FK would either block the delete or cascade the queue row away
 * with it, destroying the record that a purge was scheduled.
 *
 * The other three reasons named in `docs/rebase.md` §9A.2 have **no executor here,
 * and this build says so loudly instead of pretending**:
 *
 * - `retention_login_attempts` — `login_attempts` exists, but the predicate needs
 *   `RETENTION_LOGIN_ATTEMPTS_DAYS`, a retention key this change does not read.
 *   Inventing a window here would be a second mechanism for one decision.
 * - `retention_unverified_request` — its target table does not exist in this tree.
 * - `retention_export_artefact` — a file artefact, owned by the export work item,
 *     which does not exist in this tree.
 *
 * All three raise `UnsupportedPurgeReasonError`, so a queued row for one of them
 * ends as a `failed` row with the reason attached — visible, attributable, and
 * retried by the poison-pill ladder — rather than as a `done` row claiming zero
 * deletions. Their executors land with the migrations that create their targets.
 */
@Injectable()
export class SqlPurgeExecutor implements PurgeExecutor {
  async execute(client: PoolClient, claim: PurgeClaim): Promise<number> {
    switch (claim.reason) {
      case 'inactivity_purge':
        return this.deleteUser(client, claim);
      default:
        throw new UnsupportedPurgeReasonError(claim.reason, claim.targetKind);
    }
  }

  private async deleteUser(client: PoolClient, claim: PurgeClaim): Promise<number> {
    if (claim.targetId === null) {
      // The table's CHECK requires target_id when target_kind = 'user', so this is
      // unreachable through the claim — and it is checked anyway rather than
      // assumed, because a `DELETE ... WHERE id = NULL` deletes nothing and would
      // record that as a successful zero-row purge.
      throw new UnsupportedPurgeReasonError(claim.reason, claim.targetKind);
    }
    const result = await client.query('DELETE FROM users WHERE id = $1', [claim.targetId]);
    return result.rowCount ?? 0;
  }
}