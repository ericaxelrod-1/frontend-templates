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
 *
 * ## `rows_deleted` COUNTS THE TARGET ROWS, NOT THE CASCADED CHILDREN
 *
 * The count is what `DELETE FROM users WHERE id = $1` removed — one row for a
 * user target. It is **not** the total across the user and every table that
 * cascades with it, and the gap is deliberate rather than an oversight:
 *
 *   - The executor runs as `app_admin`, which holds no `DELETE` on
 *     `email_messages` or `refresh_tokens` and — `email_messages` being FORCE
 *     RLS'd with no `FOR UPDATE`/`FOR DELETE` policy — cannot even COUNT them:
 *     `email_read_scope` needs `authz.actor()`, which is NULL in the sweeper's
 *     claimless session. Measured as `app_admin`: `DELETE …` → `permission denied
 *     for table`; `UPDATE …` → `UPDATE 0`; `SELECT count(*)` → `0`.
 *   - So any wider total the executor returned would be a number it could not
 *     recompute and an operator could not check, which is §2.3's success-shaped
 *     value for work nobody can account for.
 *
 * Which tables follow the user out is a property of the SCHEMA, recorded table by
 * table in `database/migrations/0015_purge_user_cascade.sql`, and asserted by
 * row COUNT in `test/rls/user-purge-end-to-end.spec.ts` in both directions.
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
 * **The queue's own writes are not here, and that is deliberate.** This class is
 * given a claim and deletes what the claim names. Claiming it, completing it,
 * failing it and enqueueing it happen in `authz` — `authz.claim_due_purge()`,
 * `authz.complete_purge()`, `authz.fail_purge()`, `authz.requeue_purge()` and
 * `authz.enqueue_inactive_purges()` (`0016`) — because a bare `UPDATE` on
 * `privacy_purge_queue` is governed by a capability policy that a claimless
 * machine session cannot satisfy, and the measured result of shipping it that way
 * was a claim that matched zero rows forever with no error anywhere. `0016` also
 * revoked `UPDATE` on that table from `app_admin`, so those statements are not
 * merely unused here: they are not executable by anyone.
 *
 * The dispatch is CLOSED. An unrecognised reason raises rather than falling
 * through to a no-op, because a caller that reaches a reason this table does not
 * implement has found a bug, and returning success there is exactly the defect
 * §2.3 exists to prevent.
 *
 * ## What is implemented, and what is not, stated rather than implied
 *
 * Two of the five reason codes are implemented, and they are implemented by the
 * SAME statement:
 *
 * - `inactivity_purge` — a **tombstone**: an account an erasure already
 *   anonymised, retained for `RETENTION_TOMBSTONE_DAYS` and then hard-deleted.
 * - `inactive_account_purge` — a **live account** whose last observed activity is
 *   older than `RETENTION_INACTIVE_ACCOUNT_DAYS` and which was never soft-deleted
 *   (`0017`).
 *
 * They share `deleteUser()` because the *work* is identical: one `users` row goes
 * away. They do NOT share a code, and the reason is the operator's filter rather
 * than the executor's switch — one filterable list only works if the two
 * populations can be told apart in it, and a shared code is how a wrongly
 * configured window stops being visible as mass deletion of live accounts.
 *
 * `inactivity_purge` deletes one `users` row, identified by the
 * queue row's `target_id`. The queue row carries **no foreign key to `users`**,
 * and that is load-bearing rather than incidental — the queue row must outlive its
 * target, so an FK would either block the delete or cascade the queue row away
 * with it, destroying the record that a purge was scheduled.
 *
 * ### THE DELETE IS ONLY ABLE TO COMPLETE BECAUSE `0015` MADE IT ABLE TO COMPLETE
 *
 * Until `database/migrations/0015_purge_user_cascade.sql` this statement raised
 * `23503` for **every** user who had ever authenticated, because
 * `refresh_tokens.user_id` and `email_messages.user_id` were `NO ACTION`. The
 * sweeper reported `failed` correctly and could never report success, which reads
 * as a working mechanism to anyone who does not try a real user.
 *
 * It is stated here because the next reader of this file has to know that the one
 * line below is load-bearing on the SCHEMA, not on this code: reverting `0015`
 * silently disables every purge in the deployment, and no error at this level will
 * say so — the statement is still perfectly valid SQL. The end-to-end proof is
 * `test/rls/user-purge-end-to-end.spec.ts`, which purges a user carrying
 * `refresh_tokens`, `email_messages`, `user_roles`, `user_groups` and a
 * `privacy_requests` row, and asserts on row counts in both directions.
 *
 * The cascade's own semantics — which role's privileges govern it, why it is the
 * only available mechanism rather than the convenient one, and what `email_messages`
 * is and is not — are in `0015`. They are not restated here because two copies of
 * one argument drift (`AGENTS.md` §2.4).
 *
 * The other three reasons named in `docs/rebase.md` §9A.2 have **no executor here,
 * and this build says so loudly instead of pretending**:
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
      case 'inactive_account_purge':
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