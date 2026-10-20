import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { BreakerGate } from '../breaker/breaker-gate.js';
import { SECURITY_TELEMETRY_FLUSH } from '../breaker/dispatch-token.js';
import type { DatabaseConnectionSource } from '../common/database-pool.js';
import { SharedDatabasePool } from '../common/database-pool.js';
import { JobRunner } from '../scheduler/job-runner.service.js';
import { SecurityTelemetryCollector } from './telemetry-collector.js';
import { TELEMETRY_ENV, type TelemetryEnvironment } from './telemetry-environment.js';
import { writeTelemetry, type TelemetryWriteSummary } from './telemetry-writer.js';

/**
 * What one flush did, or found it could not do.
 *
 * A union rather than a value with optional fields, for the reason
 * `MaterializeRun` in `notifications/` is one: `ran: false` with a summary nobody
 * could produce is the shape a caller reads as "the flush ran and found nothing",
 * and that starts at the type.
 */
export type TelemetryRun =
  | {
      readonly ran: true;
      readonly summary: TelemetryWriteSummary;
      readonly buckets: number;
      readonly droppedObservations: number;
      readonly truncatedBuckets: number;
    }
  | { readonly ran: false; readonly outcome: 'gated' };

/**
 * `security.telemetry.flush` — the one place the four security-telemetry tables
 * are written.
 *
 * ## WHY A JOB AND NOT THE REQUEST
 *
 * The request path RECOGNISES a pattern; this job PERSISTS it. A scanner sending
 * ten thousand requests would, if the interceptor wrote, produce ten thousand rows
 * in four tables and make every one of those requests wait for a database round
 * trip it does not need. Here the interceptor counts in memory and this job
 * writes the aggregate — so a flood produces ONE pattern row carrying the count,
 * and the request that carried it cost a bounded number of regular expression
 * tests and nothing else.
 *
 * ## WHY IT IS A `JobRunner` JOB
 *
 * **Because the scheduler owns the single-instance property and the interval**, and
 * because a job killed mid-body is re-run from the beginning by the next process
 * that takes the lock — so the body has to be idempotent, and every statement in
 * `telemetry-writer.ts` is. The advisory lock buys "at most one at a time" and
 * nothing about "at least once"; the re-run safety lives in the body's
 * `ON CONFLICT` clauses and in the pattern row's update-then-insert pair.
 *
 * ## WHY IT IS NOT IN `BREAKER_PROTECTED`
 *
 * The same argument `NOTIFICATIONS_MATERIALIZE` makes: this is batch work with
 * nobody waiting. Its output is a row nobody has been told about yet, and the
 * next pass's window covers everything a skipped pass would have written — the
 * collector keeps the observations until the window closes, so a deferred flush
 * loses nothing. It takes a NON-stoppable lease, for the same reason the
 * materialiser does: the pass is one transaction over four tables, so it is
 * already all-or-nothing, and an abort would only add a second mechanism for that
 * property.
 */
@Injectable()
export class SecurityTelemetryFlush implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SecurityTelemetryFlush.name);

  constructor(
    @Inject(TELEMETRY_ENV) private readonly env: TelemetryEnvironment,
    @Inject(SharedDatabasePool) private readonly pool: DatabaseConnectionSource,
    private readonly collector: SecurityTelemetryCollector,
    private readonly gate: BreakerGate,
    private readonly jobs: JobRunner,
  ) {}

  onApplicationBootstrap(): void {
    this.jobs.schedule(SECURITY_TELEMETRY_FLUSH, this.env.flushSeconds, () => this.tick());
    this.logger.log(
      `security.telemetry.flush writes the four telemetry tables every ${String(this.env.flushSeconds)}s ` +
        `over a ${String(this.env.windowSeconds)}s window, alerting at ${String(this.env.alertThreshold)} matches`,
    );
  }

  onModuleDestroy(): void {
    this.jobs.stop(SECURITY_TELEMETRY_FLUSH);
  }

  /**
   * One pass.
   *
   * `nowMs` is a VALUE, not a clock call inside the work, for the reason
   * `breaker-state.ts` exists: a test that has to wait for wall time to cross a
   * window boundary is a test that will pass on the wrong side of it.
   */
  async tick(nowMs: number = Date.now()): Promise<TelemetryRun> {
    const admission = this.gate.acquire(SECURITY_TELEMETRY_FLUSH, false, nowMs);
    if (!admission.admit) {
      this.logger.warn(`security.telemetry.flush gated: ${admission.refusal}`);
      return { ran: false, outcome: 'gated' };
    }
    const lease = admission.lease;
    try {
      const snapshot = this.collector.pending(nowMs, this.env.windowSeconds);
      const summary = await this.write(snapshot, nowMs);
      // `completed` and not `succeeded`: a pass that found nothing has done the
      // whole of its work, and reporting it as a probe outcome would move the
      // breaker on an idle run.
      lease.release('completed');
      this.report(summary, snapshot.buckets.length, snapshot);
      return {
        ran: true,
        summary,
        buckets: snapshot.buckets.length,
        droppedObservations: snapshot.droppedObservations,
        truncatedBuckets: snapshot.truncatedBuckets,
      };
    } catch (error) {
      lease.release('failed');
      throw error;
    }
  }

  /**
   * The write, in ONE transaction.
   *
   * **The transaction is opened before the snapshot is taken or after?** After:
   * the snapshot is read first, so the window the write covers is the window as
   * it was when the pass began, and a request that arrives mid-pass lands in the
   * NEXT pass rather than in a transaction that is already open.
   */
  private async write(
    snapshot: ReturnType<SecurityTelemetryCollector['pending']>,
    nowMs: number,
  ): Promise<TelemetryWriteSummary> {
    const client: PoolClient = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      // The escalation boundary every writer in this application crosses, and here
      // it is doing the half nothing else can: these four tables' policies admit
      // `app_admin` and admit nothing else for a write, and that branch keys on
      // `current_user` rather than on any token field (§B2). **No claims document
      // is set here**, and none is anywhere in this tree.
      await client.query('SET LOCAL ROLE app_admin');

      const summary = await writeTelemetry(client, snapshot, this.env, nowMs);

      await client.query('COMMIT');
      committed = true;
      return summary;
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The report, and the two things the collector has to be told afterwards.
   *
   * **The alert flag and the closed windows are applied AFTER the commit.** A
   * failed write must leave the collector exactly as it was: the same window is
   * written again by the next pass, and an alert that was not committed is raised
   * again rather than being remembered as done.
   */
  private report(
    summary: TelemetryWriteSummary,
    bucketCount: number,
    snapshot: ReturnType<SecurityTelemetryCollector['pending']>,
  ): void {
    for (const key of summary.alertedKeys) {
      this.collector.markAlerted(key);
    }
    for (const bucket of snapshot.buckets) {
      if (bucket.windowClosed) {
        this.collector.close(bucket);
      }
    }
    const losses = this.collector.takeLossCounters();
    this.logger.log(
      `security.telemetry.flush wrote ${String(summary.patterns)} pattern(s), ${String(summary.links)} ` +
        `attempt link(s), ${String(summary.alerts)} alert(s) and ${String(summary.reputationRows)} reputation row(s) ` +
        `from ${String(bucketCount)} window(s)` +
        (losses.droppedObservations > 0 || losses.truncatedBuckets > 0
          ? ` — DROPPED ${String(losses.droppedObservations)} observation(s) and truncated ` +
            `${String(losses.truncatedBuckets)} identity list(s); the counts above are bounds, not counts`
          : ''),
    );
  }
}
