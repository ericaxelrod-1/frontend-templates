import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { BreakerGate } from '../breaker/breaker-gate.js';
import { NOTIFICATIONS_MATERIALIZE } from '../breaker/dispatch-token.js';
import type { DatabaseConnectionSource } from '../common/database-pool.js';
import { SharedDatabasePool } from '../common/database-pool.js';
import { JobRunner } from '../scheduler/job-runner.service.js';
import type { MaterializeSummary, Materializer } from './materializer.js';
import { REGISTERED_SOURCES, WATERMARK_SQL, materializerFor } from './materializer.js';
import type { NotificationEnvironment } from './notification-environment.js';
import { NOTIFICATIONS_ENV } from './notification-environment.js';

/**
 * What one whole pass over every registered source did.
 *
 * A union rather than a value with optional fields, for the reason `ScheduledRun` in
 * `job-runner.service.ts` is one: `ran: false` with a `summaries` array nobody could
 * produce is the shape a caller reads as "the pass ran and found nothing" (§2.3), and
 * that starts at the type.
 */
export type MaterializeRun =
  | { readonly ran: true; readonly summaries: readonly MaterializeSummary[] }
  | { readonly ran: false; readonly outcome: 'gated' };

/** One source's summary plus the window it was given, for the log line. */
export type SourceRun = {
  readonly summary: MaterializeSummary;
  readonly floorAt: Date;
  readonly watermark: Date | undefined;
};

/**
 * `notifications.materialize` — the one place a source becomes a notification.
 *
 * ## IT IS A `JobRunner` JOB AND NOTHING ELSE RUNS IT
 *
 * The interval is registered through `JobRunner.schedule`, which is the only
 * `setInterval` in `src/` outside the breaker's two per-instance instruments
 * (`test/unit/scheduler/job-interval-source.spec.ts` asserts that against the source
 * tree). So the advisory lock, the single-instance property and the dedicated
 * connection come with the call rather than with a second mechanism built here —
 * `AGENTS.md` §2.4, and the reason this file has no `setInterval`, no `lock()` of its
 * own and no `try/catch` around the timer.
 *
 * ## IDEMPOTENCE: WHAT THE BODY GUARANTEES, AND WHY THE LOCK IS NOT IT
 *
 * `JobRunner` records nothing about a run, so a job killed mid-body is re-run from the
 * beginning by the next process that gets the lock. The advisory lock therefore buys
 * *at most one at a time* and nothing about *at least once*, and the re-run safety has
 * to live in the body. It lives in one clause, in every materialiser:
 * `ON CONFLICT (source, source_ref, user_id) DO NOTHING`.
 *
 * Re-running a pass over an unchanged source writes nothing; re-running it over a
 * source that gained one row writes one row; and re-running it over a notification a
 * user has dismissed writes nothing and leaves `dismissed_at` alone. The third is the
 * one that is not obvious and the one that matters, and it is proven against a real
 * database in `test/unit/notifications/materializer.spec.ts`.
 *
 * ## THE WINDOW IS RESOLVED ONCE PER PASS, IN THIS CLASS
 *
 * Not per materialiser, and that is the reason the cursor cannot drift: one
 * `WATERMARK_SQL` read, one subtraction of the overlap, one `now`. A materialiser
 * given a window rather than asked to build one is a materialiser that cannot
 * implement its own idea of "where I got to", which is the property that makes an
 * overlap worth having.
 *
 * ## THE GATE: NAMED, SHEDDABLE, NOT STOPPABLE
 *
 * It passes `NOTIFICATIONS_MATERIALIZE`, and that token is deliberately NOT in
 * `BREAKER_PROTECTED`, for the reason `PURGE_ENQUEUER` gives at length in
 * `dispatch-token.ts`: this is batch work with nobody waiting, and deferring NEW
 * materialisations while the machine is unhealthy is the correct answer. Deferring is
 * also free — the next pass's overlap window covers everything this one skipped.
 *
 * `stoppable = false`, and the reason is the acceptance test in `BreakerGate`: "aborting
 * leaves no partial state". The pass here is several sources in ONE transaction, so a
 * mid-pass abort would leave source A rendered and source B not — recoverable, because
 * the next pass re-reads both, but not free, and the transaction already makes the
 * all-or-nothing guarantee without needing an abort to express it. Every materialiser
 * in this registry must therefore be safe to re-run, which the `ON CONFLICT` clause
 * already guarantees and which the next source inherits rather than re-decides.
 */
@Injectable()
export class NotificationMaterializer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationMaterializer.name);

  constructor(
    @Inject(NOTIFICATIONS_ENV) private readonly env: NotificationEnvironment,
    private readonly gate: BreakerGate,
    @Inject(SharedDatabasePool) private readonly pool: DatabaseConnectionSource,
    private readonly jobs: JobRunner,
  ) {}

  onApplicationBootstrap(): void {
    this.jobs.schedule(NOTIFICATIONS_MATERIALIZE, this.env.materializeIntervalSeconds, () => this.tick());
    this.logger.log(
      `notifications.materialize renders ${REGISTERED_SOURCES.length} source(s) ` +
        `(${REGISTERED_SOURCES.join(', ')}) every ${String(this.env.materializeIntervalSeconds)}s ` +
        `with a ${String(this.env.lookbackSeconds)}s overlap and a ${String(this.env.expirySeconds)}s expiry`,
    );
  }

  onModuleDestroy(): void {
    this.jobs.stop(NOTIFICATIONS_MATERIALIZE);
  }

  /**
   * One pass. `nowMs` is a VALUE, not a clock call inside the work, for the reason
   * `breaker-state.ts` exists: a test that has to wait for wall time to cross a window
   * boundary is a test that will pass on the wrong side of it.
   */
  async tick(nowMs: number = Date.now()): Promise<MaterializeRun> {
    const admission = this.gate.acquire(NOTIFICATIONS_MATERIALIZE, false, nowMs);
    if (!admission.admit) {
      this.logger.warn(`notifications.materialize gated: ${admission.refusal}`);
      return { ran: false, outcome: 'gated' };
    }
    const lease = admission.lease;
    try {
      const summaries = await this.materializeAll(new Date(nowMs));
      // `completed` and not `succeeded`: a pass that rendered nothing has done the
      // whole of its work, and reporting it as a probe outcome would move the breaker
      // on an idle run.
      lease.release('completed');
      return { ran: true, summaries };
    } catch (error) {
      lease.release('failed');
      throw error;
    }
  }

  /**
   * Every registered source, in ONE transaction.
   *
   * One transaction rather than one per source so a pass is all-or-nothing across the
   * sources too: half a pass is not a state anything downstream can reason about, and
   * the cost of the alternative is one `BEGIN` per source every five minutes.
   */
  private async materializeAll(now: Date): Promise<readonly MaterializeSummary[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // The escalation boundary every writer in this application crosses, and here it
      // is doing the half nothing else can: `admin_notifications`'s policy admits
      // `app_admin` and admits nothing else for a write, and that branch keys on
      // `current_user` rather than on any token field (§B2). **No claims document is
      // set here**, and none is anywhere in this tree — a materialiser that invented
      // `request.jwt.claims` for itself would be the request-reachable SQL path §B2
      // F1 says must not exist.
      await client.query('SET LOCAL ROLE app_admin');

      const summaries: MaterializeSummary[] = [];
      for (const source of REGISTERED_SOURCES) {
        const run = await this.materializeOne(client, materializerFor(source), now);
        summaries.push(run.summary);
      }

      await client.query('COMMIT');
      return summaries;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async materializeOne(
    client: PoolClient,
    materializer: Materializer,
    now: Date,
  ): Promise<SourceRun> {
    const watermark = await this.watermarkOf(client, materializer.source);
    // The seed IS the overlap applied to a watermark of "now": a source that has never
    // been materialised starts one window back rather than at the beginning of time,
    // so a first run is bounded instead of scanning a table nobody has a use for yet.
    const floorAt = new Date((watermark ?? now).getTime() - this.env.lookbackSeconds * 1000);
    const summary = await materializer.materialize(client, { floorAt }, this.env.expirySeconds);
    this.logger.log(
      `${materializer.source}: scanned ${String(summary.scanned)}, rendered ${String(summary.created)} ` +
        `from ${floorAt.toISOString()} to ${now.toISOString()} ` +
        `(watermark ${watermark?.toISOString() ?? 'none — first pass'})`,
    );
    return { summary, floorAt, watermark };
  }

  /** The newest `created_at` this source has rendered, or `undefined` if it has rendered none. */
  private async watermarkOf(client: PoolClient, source: string): Promise<Date | undefined> {
    const result = await client.query<{ watermark_at: Date }>(WATERMARK_SQL, [source]);
    const watermark = result.rows[0]?.watermark_at;
    // `pg` hands back `timestamptz` as a Date, but a driver that produced a string
    // here would put a string into `getTime()` and produce NaN, and a NaN floor is a
    // comparison that is never true — a materialiser that silently renders nothing.
    return watermark === undefined ? undefined : new Date(watermark);
  }
}