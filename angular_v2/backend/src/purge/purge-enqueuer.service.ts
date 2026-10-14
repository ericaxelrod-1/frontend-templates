import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { PoolClient } from 'pg';
import { BreakerGate } from '../breaker/breaker-gate.js';
import { writtenRows } from './purge-claim.js';
import type { DueTombstone, EnqueueSummary } from './purge-enqueue.js';
import { ENQUEUE_INACTIVE_PURGES_SQL, SELECT_DUE_TOMBSTONES_SQL } from './purge-enqueue.js';
import { PURGE_POOL } from './purge-sweeper.service.js';
import type { PurgeConnectionSource } from './purge-sweeper.service.js';
import { RETENTION_ENV } from './retention-environment.js';
import type { RetentionEnvironment } from './retention-environment.js';

/**
 * The scheduler token for this job's interval.
 *
 * Named, not a bare `setInterval`, so `onModuleDestroy` can find the entry it
 * registered and so the registry reads as an inventory of the two jobs this
 * process runs rather than a set of closures nobody can enumerate.
 */
export const RETENTION_ENQUEUER = 'retention.enqueuer';

/**
 * How often the scan runs.
 *
 * **A constant, not a configuration key, and that is a deliberate reversal of the
 * sibling job's treatment.** `PURGE_POLL_SECONDS` is configurable because it
 * changes how fast the queue DRAINS, which an operator tunes against a backlog.
 * This number changes neither what is due nor what happens to it: the window is
 * in DAYS, and the scan is idempotent by construction — the partial UNIQUE index
 * from `0011` means a second sweep inside one window enqueues nothing and changes
 * nothing. An hourly scan against a window measured in days is already two orders
 * of magnitude finer than the thing it measures, so a key here would be a second
 * number to get wrong and a config nobody has a reason to change.
 */
export const RETENTION_ENQUEUE_INTERVAL_SECONDS = 3600;

/**
 * The producer half of retention. The sweeper is the consumer.
 *
 * ## One job, one concern
 *
 * `PurgeSweeper` claims a row and deletes what it names. Nothing before it put
 * anything in the queue, so the mechanism it drains was inert in two independent
 * ways: a purge could never complete (fixed by `0015`) and a queue row could never
 * be claimed (fixed by `0016`). This is the third: **nothing filled the queue**, so
 * an empty admin list was the expected steady state and was not evidence that
 * retention ran at all.
 *
 * The two are separate jobs on separate schedules rather than one job with two
 * phases. They answer different questions — "is there work?" and "is there work
 * to have?" — they have different failure modes (a claim that matches nothing is
 * normal; an enqueue that finds nothing is normal; a claim that raises is not and
 * an enqueue that raises is not), and folding them together would make each one
 * silently depend on the other's interval.
 *
 * ## The window is required, and it is checked before this job can run
 *
 * `RETENTION_TOMBSTONE_DAYS` is read and bounded at module-evaluation time
 * (`retention-environment.ts`, wired in `purge.module.ts`), so a process whose
 * window is missing or nonsensical **refuses to boot** rather than booting a
 * retention job with a window it invented. There is no default anywhere on this
 * path: not here, not in the SQL, not in the function.
 *
 * ## The gate, and why the token is absent
 *
 * This job asks the breaker for a **stoppable** lease, so under memory pressure it
 * is refused rather than running — deferring NEW enqueues is the right answer when
 * the machine is unhealthy, and the sweeper keeps draining whatever is already
 * queued.
 *
 * It passes `undefined` as the dispatch token, which is the gate's "this build
 * cannot name this site" answer, and that is **fail closed**: an unnamed site is
 * unnamed, not exempt, so it cannot appear in `BREAKER_PROTECTED` and is sheddable
 * at every open zone. The honest fix is a `PURGE_ENQUEUER` token in
 * `src/breaker/dispatch-token.ts`; that file is outside this change's ownership, so
 * this job takes the conservative branch and says so rather than silently
 * claiming a protection it does not have.
 *
 * ## It logs every sweep, including the empty ones
 *
 * `scanned: 0, enqueued: 0` is the shape of a retention scan that is working and
 * has nothing to do, and it is the shape a retention scan that has silently died
 * also has. One line an hour is the difference between those two being
 * distinguishable from the log, and §2.3 is about not letting the second one read
 * as the first.
 */
@Injectable()
export class PurgeEnqueuer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PurgeEnqueuer.name);
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    @Inject(RETENTION_ENV) private readonly env: RetentionEnvironment,
    private readonly gate: BreakerGate,
    @Inject(PURGE_POOL) private readonly pool: PurgeConnectionSource,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const periodMs = RETENTION_ENQUEUE_INTERVAL_SECONDS * 1000;
    const timer = setInterval(() => {
      // The scheduler boundary is where a rejection becomes a log line rather than
      // an unhandled one, and it is the last place the error is still attributable
      // to a job.
      void this.tick().catch((error: unknown) => {
        this.logger.error(
          `retention.enqueue sweep failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, periodMs);
    timer.unref();
    this.timer = timer;
    this.scheduler.addInterval(RETENTION_ENQUEUER, timer);
    this.logger.log(
      `retention.enqueue sweeps every ${RETENTION_ENQUEUE_INTERVAL_SECONDS}s for tombstones older than ${String(this.env.tombstoneDays)} day(s)`,
    );
  }

  onModuleDestroy(): void {
    const timer = this.timer;
    this.timer = undefined;
    if (timer !== undefined) {
      clearInterval(timer);
    }
    if (this.scheduler.doesExist('interval', RETENTION_ENQUEUER)) {
      this.scheduler.deleteInterval(RETENTION_ENQUEUER);
    }
  }

  /**
   * One sweep. Overlap is refused rather than awaited, and the latch is released
   * in `finally` so a failed sweep cannot wedge the job permanently — the same
   * two-sided trap as the sweeper's latch, where a latch cleared only on success
   * is a sweeper that stopped.
   */
  async tick(nowMs: number = Date.now()): Promise<EnqueueSummary> {
    if (this.ticking) {
      this.logger.warn('retention.enqueue sweep skipped: the previous sweep is still running');
      return { scanned: 0, enqueued: 0, outcome: 'nothing_due' };
    }
    this.ticking = true;
    try {
      return await this.sweep(nowMs);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * One gate decision for one sweep.
   *
   * Not one per statement, and the difference from the sweeper is the number of
   * acts: a sweep is a single transaction with a single decision at its head, so
   * consulting the gate between the scan and the enqueue would buy nothing and
   * would produce a summary whose halves came from two different worlds.
   */
  async sweep(nowMs: number = Date.now()): Promise<EnqueueSummary> {
    const admission = this.gate.acquire(undefined, true, nowMs);
    if (!admission.admit) {
      this.logger.warn(`retention.enqueue gated: ${admission.refusal}`);
      return { scanned: 0, enqueued: 0, outcome: 'gated' };
    }
    const lease = admission.lease;
    try {
      const summary = await this.enqueueDue();
      lease.release(summary.enqueued > 0 ? 'succeeded' : 'completed');
      this.logger.log(
        `retention.enqueue scanned ${String(summary.scanned)} due tombstone(s) and enqueued ${String(summary.enqueued)}`,
      );
      return summary;
    } catch (error) {
      lease.release('failed');
      throw error;
    }
  }

  /**
   * Scan and enqueue, in ONE transaction.
   *
   * `SET LOCAL ROLE app_admin` is the escalation boundary the sweeper already
   * uses, and here it is doing the half that cannot be done any other way: it is
   * the identity for which `users_read_scope` keeps the admin branch, so the scan
   * can see tombstones at all (`0009:214-226`). It is also the only principal with
   * `EXECUTE` on either function. Claims alone cannot buy either, because the
   * admin branch of a policy discriminates on `current_user` and never on a token
   * field (`AGENTS.md` §B2).
   *
   * **No claims document is set here**, and none is anywhere in this tree. The one
   * identity this job could have invented for itself — `request.jwt.claims` — is a
   * custom GUC any role may `SET` (§B2 F1), and the whole mitigation is
   * architectural: no request-reachable SQL path may write it. A retention job
   * that wrote its own would be that path, standing.
   *
   * The window is BOUND, never interpolated. `$1` reaches `now() - make_interval(days
   * => $1::integer)` as a parameter, so the value cannot become syntax and cannot
   * be absent.
   */
  private async enqueueDue(): Promise<EnqueueSummary> {
    const client: PoolClient = await this.pool.connect();
    let settled = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const due = await client.query<DueTombstone>(SELECT_DUE_TOMBSTONES_SQL, [this.env.tombstoneDays]);
      const targetIds = due.rows.map((row) => row.user_id);
      if (targetIds.length === 0) {
        await client.query('COMMIT');
        settled = true;
        return { scanned: 0, enqueued: 0, outcome: 'nothing_due' };
      }

      const enqueued = writtenRows(await client.query(ENQUEUE_INACTIVE_PURGES_SQL, [targetIds]));
      await client.query('COMMIT');
      settled = true;
      return { scanned: targetIds.length, enqueued, outcome: 'enqueued' };
    } catch (error) {
      if (!settled) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
