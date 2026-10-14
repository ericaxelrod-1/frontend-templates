import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { PoolClient } from 'pg';
import type { BreakerEnvironment } from '../breaker/breaker-environment.js';
import { BREAKER_ENV } from '../breaker/breaker-environment.js';
import { BreakerGate } from '../breaker/breaker-gate.js';
import type { DispatchLease } from '../breaker/breaker-gate.js';
import { PURGE_SWEEPER } from '../breaker/dispatch-token.js';
import type { PurgeClaim, PurgeClaimRow } from './purge-claim.js';
import {
  CLAIM_DUE_PURGE_SQL,
  COMPLETE_PURGE_SQL,
  FAIL_PURGE_SQL,
  PURGE_WORK_SAVEPOINT,
  REQUEUE_PURGE_SQL,
  RELEASE_PURGE_WORK,
  ROLLBACK_TO_PURGE_WORK,
  toPurgeClaim,
} from './purge-claim.js';
import { UnsupportedPurgeReasonError } from './purge-executor.js';
import type { PurgeExecutor } from './purge-executor.js';
import { PURGE_EXECUTOR } from './purge-executor.js';
import type { DrainStep, DrainStepOutcome } from './purge-plan.js';
import { planDrainStep } from './purge-plan.js';

/**
 * The connection source the sweeper needs, and nothing more.
 *
 * A narrow structural port rather than the `Pool` class, so the unit suite can
 * assert that a **gated** dispatch never reaches the database at all — the
 * strongest available statement that GATE is a dispatch decision and not a slow
 * rejection — without standing up a cluster and without a stand-in for a real
 * integration in application code (`AGENTS.md` §2.2). `pg.Pool` satisfies it
 * structurally and is the only thing ever bound to it.
 */
export type PurgeConnectionSource = {
  connect(): Promise<PoolClient>;
};

/** The DI token for the one connection pool the sweeper owns. */
export const PURGE_POOL = 'PURGE_POOL';

export type TickSummary = {
  readonly executed: number;
  readonly rowsDeleted: number;
  readonly failed: number;
  readonly lastOutcome: DrainStepOutcome | 'nothing_due';
};

/**
 * The first real job in `angular_v2`, and the reason the breaker exists.
 *
 * ## What it is recoverable by, and why that is a design constraint
 *
 * The sweeper's acceptance criterion is **"aborting leaves no partial state"**,
 * and it satisfies it for exactly one reason: **claim, delete and mark-done are
 * ONE transaction.** A `DELETE` inside a transaction that is aborted is not a
 * partial deletion; it is no deletion. So the queue row returns to `pending`, its
 * `attempt` counter rolls back with everything else (so the next attempt
 * re-increments it correctly rather than consuming an attempt that never
 * happened), its `error` stays unset, and nothing was deleted.
 *
 * A design that split the purge into claim / delete / mark-done would fail that
 * contract, and the honest response would be to drop the sweeper out of the STOP
 * set — **not** to add a compensating "partial" mode. A breaker that can produce
 * half a purge is worse than one that cannot purge. Any future split of this
 * transaction must carry that decision with it.
 *
 * ## The abort handle is a required parameter, and this file constructs no controller
 *
 * The legacy's delete path builds an `AbortController`, arms it, and then calls
 * the provider **without passing `controller.signal`** — a controller constructed
 * and not passed is not a timeout, it is a comment. It produces the complete
 * appearance of a recoverable abort and none of the behaviour, and it survives
 * review because the surrounding code is correct: `clearTimeout` in the `finally`
 * looks precisely like the cleanup a timeout needs. No test at all stays green
 * against it.
 *
 * So there is no `new AbortController()` anywhere in `src/` except inside the
 * gate — enforced by ESLint, not by a review comment (`AGENTS.md` §3) — and
 * `sweep(signal)` takes the handle the gate handed out. The bug is unrepresentable
 * rather than merely untested.
 */
@Injectable()
export class PurgeSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PurgeSweeper.name);
  /**
   * The ownership key written to `claimed_by`.
   *
   * The legacy queue had no owner column at all — `lockedAt` recorded *when*,
   * never *who* — so two sweepers were indistinguishable and no read could
   * predicate on ownership even when it wanted to. Every statement after the claim
   * carries it.
   */
  private readonly instanceId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    @Inject(BREAKER_ENV) private readonly env: BreakerEnvironment,
    private readonly gate: BreakerGate,
    @Inject(PURGE_POOL) private readonly pool: PurgeConnectionSource,
    @Inject(PURGE_EXECUTOR) private readonly executor: PurgeExecutor,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const periodMs = this.env.purgePollSeconds * 1000;
    const timer = setInterval(() => {
      // `tick()` rejects on a real failure; the scheduler boundary is where that
      // becomes a log line instead of an unhandled rejection, and it is the last
      // place the error is still attributable to a job and an instance.
      void this.tick().catch((error: unknown) => {
        this.logger.error(
          `purge.sweeper tick failed (instance ${this.instanceId}): ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, periodMs);
    timer.unref();
    this.timer = timer;
    this.scheduler.addInterval(PURGE_SWEEPER, timer);
    this.logger.log(`purge.sweeper ticks every ${this.env.purgePollSeconds}s, instance ${this.instanceId}`);
  }

  onModuleDestroy(): void {
    const timer = this.timer;
    this.timer = undefined;
    if (timer !== undefined) {
      clearInterval(timer);
    }
    if (this.scheduler.doesExist('interval', PURGE_SWEEPER)) {
      this.scheduler.deleteInterval(PURGE_SWEEPER);
    }
  }

  /**
   * One tick. Overlap is refused rather than awaited: two drains racing for the
   * same queue is precisely the legacy's `@Cron`-plus-`while (true)` defect, and
   * the latch is released in `finally` so a failed tick cannot wedge the sweeper
   * permanently — the same two-sided trap as the meter's latch, where a latch
   * cleared only on success is a meter that stopped.
   */
  async tick(nowMs: number = Date.now()): Promise<TickSummary> {
    if (this.ticking) {
      this.logger.warn('purge.sweeper tick skipped: the previous tick is still running');
      return {
        executed: 0,
        rowsDeleted: 0,
        failed: 0,
        lastOutcome: 'nothing_due',
      };
    }
    this.ticking = true;
    try {
      return await this.sweep(nowMs);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * The drain.
   *
   * The gate is consulted for **every** purge rather than once per tick: it is a
   * decision made by a separate job on a separate schedule, and a decision is only
   * real where it is consulted. Consulting it once at the top of the tick would
   * mean a breaker that opened one microsecond later still drained the rest of the
   * batch — a gate that gates nothing after the first call.
   */
  async sweep(nowMs: number = Date.now()): Promise<TickSummary> {
    const budget = this.env.purgeDrainBudget;
    let executed = 0;
    let rowsDeleted = 0;
    let failed = 0;
    // Assigned on every path that returns it, and never read before that — the
    // `nothing_due` default that a reader expects to find here would be a value
    // nothing could observe.
    let lastOutcome: DrainStepOutcome | 'nothing_due';

    while (true) {
      const admission = this.gate.acquire(PURGE_SWEEPER, true, nowMs);
      if (!admission.admit) {
        lastOutcome = 'gated';
        this.logger.warn(`purge.sweeper gated after ${executed} purge(s): ${admission.refusal}`);
        return { executed, rowsDeleted, failed, lastOutcome };
      }
      const lease: DispatchLease = admission.lease;

      let step: DrainStep;
      try {
        step = planDrainStep({
          budgetRemaining: budget - executed,
          admit: true,
          probe: lease.probe,
          aborted: lease.signal?.aborted === true,
        });
        if (!step.attempt) {
          lease.release(lease.signal?.aborted === true ? 'aborted' : 'completed');
          return { executed, rowsDeleted, failed, lastOutcome: step.outcome };
        }

        const result = await this.sweepOne();
        if (result === undefined) {
          lease.release('completed');
          return { executed, rowsDeleted, failed, lastOutcome: 'nothing_due' };
        }
        if (result.failed) {
          failed += 1;
        } else {
          rowsDeleted += result.rowsDeleted;
          if (result.rowsDeleted === 0) {
            // Surfaced, not swallowed. A zero-row delete means the target was
            // already absent when the sweep reached it, which an operator has to be
            // able to see and which is otherwise indistinguishable from a
            // double-queued purge that "deleted a row that was already gone".
            this.logger.warn(`purge ${result.id} deleted 0 rows: its target was already absent`);
          }
        }
        executed += 1;
        lastOutcome = step.outcome;
      } catch (error) {
        lease.release('failed');
        throw error;
      }

      if (lease.probe) {
        // Exactly one execution for a half-open admission. A probe that drained the
        // queue would recreate the pressure that opened the breaker.
        lease.release(failed > 0 && executed === failed ? 'failed' : 'succeeded');
        return { executed, rowsDeleted, failed, lastOutcome };
      }
      lease.release('completed');
    }
  }

  /**
   * One purge, in one transaction: claim, delete, mark done.
   *
   * `BEGIN` first, so the claim's row locks and its `status = 'claimed'` marker
   * are the same transaction as the deletion. Committing the claim on its own
   * would mean a process death between claim and delete strands a row in
   * `claimed` with nothing to reclaim it — precisely the `locked_at` situation the
   * legacy needed a staleness monitor to clean up. This design has neither the
   * column nor the monitor, because there is no window to strand a row in.
   *
   * `SET LOCAL ROLE app_admin` before any write: claims alone cannot buy write
   * access, because the admin branch of a policy discriminates on `current_user`
   * and never on a token field (`AGENTS.md` §B2). This is the same escalation
   * boundary `database/seed.ts` and `AuthService` use.
   *
   * ## The savepoint, and why the failure is not written after the rollback
   *
   * A `DELETE` that raises aborts the transaction, so the failure cannot be
   * written after a whole-transaction `ROLLBACK`: that rollback restores the row
   * to `pending` with `claimed_by = NULL`, so the failure write's ownership
   * predicate (`status = 'claimed' AND claimed_by = $instance`) matches **zero**
   * rows. The error would be recorded nowhere, `attempt` would never advance, and
   * a purge that always fails would be retried forever with `failed: true`
   * reported for each attempt — a success-shaped outcome for work that did not
   * happen, and `RETENTION_PURGE_MAX_ATTEMPTS` unreachable.
   *
   * So the delete is wrapped in `SAVEPOINT purge_work`: a failed purge unwinds
   * the deletion alone, keeps the claim, writes the terminal or requeue status in
   * the same transaction and commits. The row therefore never leaves this
   * transaction in `claimed` — the ownership key is set and cleared inside one
   * transaction, so there is still no window for another sweeper to see a stranded
   * claim and no `locked_at`.
   *
   * An ABORT of the whole transaction (the gate's STOP, a dropped connection, a
   * process death) still rolls back the claim with the deletion. That is the
   * "aborting leaves no partial state" criterion, and a partial purge is not
   * representable.
   */
  private async sweepOne(): Promise<
    | {
        readonly id: string;
        readonly rowsDeleted: number;
        readonly failed: boolean;
      }
    | undefined
  > {
    const client: PoolClient = await this.pool.connect();
    let settled = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const claim = await this.claimOne(client);
      if (claim === undefined) {
        await client.query('COMMIT');
        settled = true;
        return undefined;
      }

      await client.query(PURGE_WORK_SAVEPOINT);
      try {
        const rowsDeleted = await this.executor.execute(client, claim);
        await client.query(RELEASE_PURGE_WORK);
        const completed = await client.query(COMPLETE_PURGE_SQL, [claim.id, this.instanceId, rowsDeleted]);
        if ((completed.rowCount ?? 0) !== 1) {
          // The ownership predicate did not match, which means this sweeper no
          // longer owns the row. Reporting success here would be §2.3's
          // success-shaped value for work that did not happen.
          throw new Error(
            `purge ${claim.id} could not be marked done: no row matched status 'claimed' for this instance`,
          );
        }
        await client.query('COMMIT');
        settled = true;
        return { id: claim.id, rowsDeleted, failed: false };
      } catch (error) {
        // Undo the deletion, keep the claim: the row is still `claimed` by this
        // instance, which is the only thing that lets the ownership predicate
        // below match. If this rollback itself fails the error propagates, the
        // outer handler rolls the whole transaction back, and the row is left
        // `pending` and untouched — never claimed by a sweeper that has stopped.
        await client.query(ROLLBACK_TO_PURGE_WORK);
        await this.recordFailure(client, claim, error);
        await client.query('COMMIT');
        settled = true;
        return { id: claim.id, rowsDeleted: 0, failed: true };
      }
    } catch (error) {
      if (!settled) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * `SELECT … FOR UPDATE SKIP LOCKED` and the `UPDATE` that marks the claim, in
   * ONE statement — see `CLAIM_DUE_PURGE_SQL` for why the two cannot be separate.
   */
  private async claimOne(client: PoolClient): Promise<PurgeClaim | undefined> {
    const claimed = await client.query<PurgeClaimRow>(CLAIM_DUE_PURGE_SQL, [this.instanceId]);
    const row = claimed.rows[0];
    if (row === undefined) {
      return undefined;
    }
    const claim = toPurgeClaim(row);
    if (claim === undefined) {
      // Refusing to guess is the same rule the executor follows for an
      // unrecognised reason. Throwing rolls the claim back, so the row returns to
      // `pending` untouched and the next tick re-claims it — the alternative
      // would be writing a `done` row for work that did not happen.
      throw new UnsupportedPurgeReasonError(`target_kind=${row.target_kind}`, row.target_kind);
    }
    return claim;
  }

  /**
   * The poison pill ladder, in the CALLER's transaction.
   *
   * At `RETENTION_PURGE_MAX_ATTEMPTS` the row becomes `failed`, **keeps its
   * error**, and stays visible in the admin view for an operator. An unbounded
   * retry loop on a delete that keeps failing is a resource leak of exactly the
   * kind the breaker exists to prevent, and this repository shares a machine.
   *
   * Before the limit the row returns to `pending` for another attempt with the
   * error kept, so the reason survives into the next try instead of being lost.
   *
   * **No connection, no `BEGIN`, no `COMMIT` here.** The claim that these
   * statements predicate on is uncommitted work in this very transaction, so a
   * second connection could not see it — which is the defect this replaced: the
   * write ran on its own connection after the transaction had been rolled back, so
   * `status = 'claimed' AND claimed_by = $instance` matched nothing and the row
   * was retried forever. The claim and the failure write must share a
   * transaction, or the ownership predicate is a lie.
   *
   * A failure to write the failure propagates: the caller rolls the whole
   * transaction back, which leaves the row `pending` and untouched — better a
   * retried purge than a `failed` row whose reason nobody recorded.
   */
  private async recordFailure(client: PoolClient, claim: PurgeClaim, cause: unknown): Promise<void> {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const exhausted = claim.attempt >= this.env.purgeMaxAttempts;
    const written = await client.query(exhausted ? FAIL_PURGE_SQL : REQUEUE_PURGE_SQL, [
      claim.id,
      this.instanceId,
      detail.slice(0, 2000),
    ]);
    if ((written.rowCount ?? 0) !== 1) {
      throw new Error(
        `purge ${claim.id} could not record its failure: no row matched status 'claimed' for this instance`,
      );
    }
    this.logger.error(
      exhausted
        ? `purge ${claim.id} failed ${claim.attempt} time(s) and is now 'failed', error kept: ${detail}`
        : `purge ${claim.id} failed (attempt ${claim.attempt}/${this.env.purgeMaxAttempts}) and returned to the queue: ${detail}`,
    );
  }
}

/** Re-exported so a caller can name the refusal without importing the executor module. */
export { UnsupportedPurgeReasonError };
