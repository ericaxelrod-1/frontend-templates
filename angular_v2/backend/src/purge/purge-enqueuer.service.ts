import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { PoolClient } from 'pg';
import { BreakerGate } from '../breaker/breaker-gate.js';
import { PURGE_ENQUEUER } from '../breaker/dispatch-token.js';
import { writtenRows } from './purge-claim.js';
import type { DuePurge, EnqueueSummary } from './purge-enqueue.js';
import { ENQUEUE_INACTIVE_PURGES_SQL, SELECT_DUE_PURGES_SQL, splitByPopulation } from './purge-enqueue.js';
import { PURGE_POOL } from './purge-sweeper.service.js';
import type { PurgeConnectionSource } from './purge-sweeper.service.js';
import { RETENTION_ENV } from './retention-environment.js';
import type { RetentionEnvironment } from './retention-environment.js';

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
 * `PurgeSweeper` claims a row and deletes what it names; this job decides what is
 * worth claiming. **The two halves of the mechanism were inert for two
 * independent reasons before `0015` and `0016`, and both mattered:** a purge could
 * never complete (the two `NO ACTION` foreign keys naming `users`, fixed by
 * `0015`) and a queue row could never be claimed (the read policy is capability
 * alone, and the machine has no capability claim, fixed by `0016`). This job is
 * the third, and it is the one that was true until `0016` shipped it: **nothing
 * filled the queue**, so an empty admin list was the expected steady state and
 * was not evidence that retention ran at all.
 *
 * The two are separate jobs on separate schedules rather than one job with two
 * phases. They answer different questions — "is there work to have?" and "is
 * there work?" — they have different failure modes (an enqueue that finds nothing
 * is normal; a claim that matches nothing is normal; an enqueue that raises is not
 * and a claim that raises is not), and folding them together would make each one
 * silently depend on the other's interval.
 *
 * ## What is enqueued, and what still is not
 *
 * The scan reads TWO columns and covers TWO populations, which is what §9A.6's
 * second anchor asks for and what `0017` shipped:
 *
 *   * `users.deleted_at` — a **tombstone**: a row an erasure already anonymised,
 *     aged from the moment the erasure happened, and written as
 *     `inactivity_purge`.
 *   * `users.last_activity_at` — a **live account** whose last OBSERVED activity
 *     is old, and **never soft-deleted**, so the two populations cannot overlap
 *     in one sweep. Written as `inactive_account_purge`, a distinct code, because
 *     the operator's requirement is one filterable list and a shared code would
 *     make the two indistinguishable in it.
 *
 * **A third population is deliberately absent, and its absence is the design:**
 * an account whose `last_activity_at` IS NULL. That is "never observed", not
 * "dormant", and `0017` §1 refuses to destroy an account on the strength of a
 * measurement that was never taken. The cost is stated there too: an account
 * created before `0017` and never authenticated again is retained forever, which
 * is the recoverable error.
 *
 * **This is not the erasure path.** A privacy deletion request has no
 * implementation in this tree; this job ages accounts that were never asked to
 * leave. Wiring a legal request to an unattended hourly scan would be the opposite
 * of the separation `0011` exists to keep.
 *
 * ## The two windows are required, and they are checked before this job can run
 *
 * `RETENTION_TOMBSTONE_DAYS` and `RETENTION_INACTIVE_ACCOUNT_DAYS` are read and
 * bounded at module-evaluation time (`retention-environment.ts`, wired in
 * `purge.module.ts`), so a process whose windows are missing, or below their
 * floors — 1825 days and 1095 — **refuses to boot** rather than booting a
 * retention job with a window it invented. There is no default anywhere on this
 * path: not here, not in the SQL, not in the functions.
 *
 * ## The gate: named, sheddable, stoppable
 *
 * This job asks the breaker for a **stoppable** lease, so under memory pressure it
 * is refused rather than running — deferring NEW enqueues is the right answer when
 * the machine is unhealthy, and the sweeper keeps draining whatever is already
 * queued.
 *
 * It passes `PURGE_ENQUEUER`, its real dispatch token, and **that token is
 * deliberately NOT in `BREAKER_PROTECTED`.** It used to pass `undefined`, which is
 * fail-closed but is also "this build cannot name this site" — undocumented
 * infrastructure behaving by accident rather than by decision. The default is STOP,
 * and shedding an hourly batch scan with no user waiting on it is what shedding is
 * *for*: every one of the six protected tokens is request-path work whose caller is
 * blocked on the answer. The reasoning is written down at the token itself, in
 * `src/breaker/dispatch-token.ts`, because the next reader will otherwise assume
 * the omission is a bug and add it.
 *
 * **Stopping it mid-transaction is safe, because the abort is honoured and the
 * transaction is the unit.** An abort is a signal and not a cancellation — the gate
 * counts a stopped dispatch as still live until its owner releases the lease — so
 * `enqueueDue(signal)` reads `signal.aborted` itself, **twice**: after the scan and
 * again before the `COMMIT`. Each check rolls the whole transaction back and
 * reports `outcome: 'aborted'`, so a queue row exists for every due tombstone or
 * for none of them. A process death mid-sweep rolls the same transaction back.
 *
 * This used not to be true: the job asked for a stoppable lease and never read the
 * handle, which is the same defect as an `AbortController` constructed and not
 * passed on — the complete appearance of a recoverable abort and none of the
 * behaviour, surviving review because the surrounding code is correct.
 * `test/unit/purge/purge-enqueuer-scheduling.spec.ts` stops mid-scan and mid-INSERT
 * and asserts the queue is unchanged in both, and the second check exists precisely
 * because the first alone would let an abort during the `INSERT` commit anyway.
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
          `purge.enqueuer sweep failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, periodMs);
    timer.unref();
    this.timer = timer;
    // The DISPATCH TOKEN is the registry key too, exactly as `PurgeSweeper` does
    // it. This file previously exported a second name for the same job
    // (`RETENTION_ENQUEUER = 'retention.enqueuer'`), which meant the gate refused
    // `purge.enqueuer` in one vocabulary while the scheduler listed
    // `retention.enqueuer` in another and the log line said a third thing. One
    // job, one name, and `onModuleDestroy` can find the entry it registered.
    this.scheduler.addInterval(PURGE_ENQUEUER, timer);
    this.logger.log(
      `purge.enqueuer sweeps every ${RETENTION_ENQUEUE_INTERVAL_SECONDS}s for tombstones older than ` +
        `${String(this.env.tombstoneDays)} day(s) and accounts unobserved for ${String(this.env.inactiveAccountDays)} day(s)`,
    );
  }

  onModuleDestroy(): void {
    const timer = this.timer;
    this.timer = undefined;
    if (timer !== undefined) {
      clearInterval(timer);
    }
    if (this.scheduler.doesExist('interval', PURGE_ENQUEUER)) {
      this.scheduler.deleteInterval(PURGE_ENQUEUER);
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
      this.logger.warn('purge.enqueuer sweep skipped: the previous sweep is still running');
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
   * One gate decision for one sweep, taken as `PURGE_ENQUEUER`.
   *
   * Not one per statement, and the difference from the sweeper is the number of
   * acts: a sweep is a single transaction with a single decision at its head, so
   * consulting the gate between the scan and the enqueue would buy nothing and
   * would produce a summary whose halves came from two different worlds.
   *
   * `stoppable = true`, so this lease carries an `AbortSignal` and the gate may
   * stop a scan already in flight. A stopped sweep **rolls back and says so**:
   * `outcome: 'aborted'`, `enqueued: 0`, and the lease is released `'aborted'` —
   * never released as `'completed'`, which is the success-shaped value for work
   * that did not happen (§2.3).
   */
  async sweep(nowMs: number = Date.now()): Promise<EnqueueSummary> {
    const admission = this.gate.acquire(PURGE_ENQUEUER, true, nowMs);
    if (!admission.admit) {
      this.logger.warn(`purge.enqueuer gated: ${admission.refusal}`);
      return { scanned: 0, enqueued: 0, outcome: 'gated' };
    }
    const lease = admission.lease;
    try {
      const summary = await this.enqueueDue(lease.signal);
      if (summary.outcome === 'aborted') {
        lease.release('aborted');
        this.logger.warn(
          `purge.enqueuer stopped mid-sweep after scanning ${String(summary.scanned)} due row(s): the transaction was rolled back and the queue is unchanged`,
        );
        return summary;
      }
      lease.release(summary.enqueued > 0 ? 'succeeded' : 'completed');
      this.logger.log(
        `purge.enqueuer scanned ${String(summary.scanned)} due row(s) and enqueued ${String(summary.enqueued)}`,
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
   * `SET LOCAL ROLE app_admin` is the escalation boundary the sweeper already uses,
   * and here it is doing the half that cannot be done any other way: it is the
   * identity for which `users_read_scope` keeps the admin branch, so the scan can see
   * every population at all (`0009:214-226`). It is also the only principal with
   * `EXECUTE` on any of the three functions this job calls — `app_anon` and
   * `app_member` are deliberately absent (`0016`, `0017` §7). Claims alone cannot buy
   * either, because the admin branch of a policy discriminates on `current_user` and
   * never on a token field (`AGENTS.md` §B2).
   *
   * **No claims document is set here**, and none is anywhere in this tree. The one
   * identity this job could have invented for itself — `request.jwt.claims` — is a
   * custom GUC any role may `SET` (§B2 F1), and the whole mitigation is
   * architectural: no request-reachable SQL path may write it. A retention job
   * that wrote its own would be that path, standing.
   *
   * **Both windows are BOUND, never interpolated.** `$1` and `$2` reach the two
   * `retention_due_*()` functions as parameters, so neither value can become
   * syntax and neither can be absent — and each function refuses a value below
   * its own floor with `22023`, naming its own argument.
   *
   * ## The abort is honoured at TWO points, and why that is not belt-and-braces
   *
   * `signal` is the lease's own handle and this method reads it **before the
   * enqueue and again before the COMMIT**. A lease that advertises stoppability
   * the owner never checks is the same defect as an `AbortController` constructed
   * and never passed on — the complete appearance of a recoverable abort and none
   * of the behaviour, and it survives review because the surrounding code is
   * correct. `AGENTS.md` §3 forbids the constructor form of it; this is the same
   * shape one layer up, and `test/unit/purge/purge-enqueuer-scheduling.spec.ts`
   * is what proves the flag is read rather than merely received.
   *
   * Two checks and not one because the scan is the only expensive step: an abort
   * that arrives during the scan has done the read work already and must not pay
   * for the write, and an abort that arrives during the `INSERT` must not pay for
   * the commit. Between them they cover every point at which something can be
   * given up, and each one leaves the transaction **exactly** as it was — the
   * `ROLLBACK` is unconditional on this path, and the `COMMIT` is unreachable once
   * either check has fired.
   */
  private async enqueueDue(signal: AbortSignal | undefined): Promise<EnqueueSummary> {
    // A function rather than an inlined `signal?.aborted === true` twice, because
    // TypeScript narrows a property access and would then compile the second
    // check to a comparison it can prove is always false — which is exactly the
    // narrowing that would make this code look correct and be wrong. Nothing in
    // the type system knows that `AbortController.abort()` happened on another
    // task's turn of the event loop while we awaited a round trip.
    const stopped = (): boolean => signal?.aborted === true;
    const client: PoolClient = await this.pool.connect();
    let settled = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const due = await client.query<DuePurge>(SELECT_DUE_PURGES_SQL, [
        this.env.tombstoneDays,
        this.env.inactiveAccountDays,
      ]);
      const populations = splitByPopulation(due.rows);
      const targetCount = populations.tombstoneIds.length + populations.inactiveAccountIds.length;
      if (stopped()) {
        await client.query('ROLLBACK');
        settled = true;
        return { scanned: targetCount, enqueued: 0, outcome: 'aborted' };
      }
      if (targetCount === 0) {
        await client.query('COMMIT');
        settled = true;
        return { scanned: 0, enqueued: 0, outcome: 'nothing_due' };
      }

      // Both arrays go to the same statement, and the REASON is not one of the
      // parameters: `authz.enqueue_inactive_purges` names `inactivity_purge` for the
      // first array and `inactive_account_purge` for the second in its own body, so
      // a caller cannot file a live account under the tombstone code. The empty array
      // is legitimate — one population can have nothing due while the other has
      // something — and `NULL` is not, which is why this is `[]` and never undefined.
      const enqueued = writtenRows(
        await client.query(ENQUEUE_INACTIVE_PURGES_SQL, [
          populations.tombstoneIds,
          populations.inactiveAccountIds,
        ]),
      );
      if (stopped()) {
        // The rows are written and uncommitted. Rolling back is what makes the
        // stop real: without it the summary below would say `aborted` over a queue
        // that gained every row anyway, which is §2.3's success-shaped lie in its
        // most literal form.
        await client.query('ROLLBACK');
        settled = true;
        return { scanned: targetCount, enqueued: 0, outcome: 'aborted' };
      }
      await client.query('COMMIT');
      settled = true;
      return { scanned: targetCount, enqueued, outcome: 'enqueued' };
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
