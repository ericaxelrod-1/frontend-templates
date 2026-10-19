import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { BreakerGate } from '../breaker/breaker-gate.js';
import { CONSENT_PURGE } from '../breaker/dispatch-token.js';
import type { DatabaseConnectionSource } from '../common/database-pool.js';
import { SharedDatabasePool } from '../common/database-pool.js';
import { JobRunner } from '../scheduler/job-runner.service.js';
import { RETENTION_ENV } from './retention-environment.js';
import type { RetentionEnvironment } from './retention-environment.js';

/**
 * The one statement this job makes.
 *
 * A function call and not a `DELETE`, because the function IS the only legitimate
 * deleter of `consent_records`: the table refuses `DELETE` to every serving role
 * (`0028`) and refuses it a second time by name from a trigger, and the function is
 * the one path that is admitted. Writing the `DELETE` here would fail with
 * `permission denied` — correctly.
 *
 * The cast is explicit because the parameter arrives as an untyped placeholder: the
 * function's signature is `integer`, and `$1::integer` says so at the call site
 * rather than leaving it to inference.
 */
export const PURGE_EXPIRED_CONSENT_RECORDS_SQL =
  'SELECT authz.purge_expired_consent_records($1::integer) AS removed';

/**
 * What one sweep did.
 *
 * A union rather than a value with optional fields, for the reason `ScheduledRun` in
 * `job-runner.service.ts` is one: `removed: 0` on a run that was refused by the
 * breaker and `removed: 0` on a run that found nothing are the same number and two
 * completely different facts, and only one of them is a success. §2.3 says a job that
 * did not happen must not report a success-shaped result, and that starts at the type.
 */
export type ConsentPurgeRun =
  | { readonly ran: true; readonly removed: number }
  | { readonly ran: false; readonly outcome: 'gated' };

/**
 * `consent.purge` — the retention sweep for the consent records of erased people.
 *
 * ## WHAT THIS JOB IS FOR, AND WHY IT HAD TO EXIST
 *
 * `0028` built the consent model and, with it, the one legitimate deleter:
 *
 *     authz.purge_expired_consent_records(p_window_days integer)
 *
 * It has a grant (`app_admin`), a required window, a bound, and a trigger that
 * creates the rows it exists to delete — `authz.pseudonymize_consent_series()`
 * nulls `user_id` on every record of an erased person, and the orphan is what a
 * retention window can act on. **And nothing called it.** So the consent record of
 * every erased person accumulated forever, and the retention policy this template
 * publishes did not happen.
 *
 * The function was correct; it was unreachable from the application. This file is
 * the missing half: the job that calls it, on a schedule, under a lock.
 *
 * ## WHY IT IS A `JobRunner` JOB AND NOT A FOURTH `setInterval`
 *
 * `AGENTS.md` §2.4: one mechanism per concern. The runner owns the interval, the
 * single-instance advisory lock, the dedicated connection and the failure logging,
 * so a second timer here would be a second mechanism for "is this job running" — and
 * the one that already failed once, because a job that exists and is never called
 * is indistinguishable from a job that does not exist.
 *
 * ## THE WINDOW IS `RETENTION_TOMBSTONE_DAYS`, AND THAT IS NOT A SECOND POLICY
 *
 * `0028` says it in the migration's own words: *"THE WINDOW IS A PARAMETER AND NOT
 * A NEW CONFIG KEY … the caller passes the value it already has."* This is that
 * caller.
 *
 * The reason it is the RIGHT window, and not merely the available one: a consent
 * record is keyed to a PERSON (`0028`'s decision 4), and the record of an erased
 * person is the compliance evidence for that erasure. The tombstone of a person is
 * kept for five years because the law requires the record of the erasure to
 * survive; the consent record of the same person is evidence of the same erasure,
 * for the same period, and expiring it earlier would leave the erasure
 * unprovable. One window, one policy, one clock.
 *
 * ## THE LEASE IS NOT STOPPABLE, AND THAT IS THE SAME ARGUMENT THE MATERIALISER MAKES
 *
 * The body is ONE statement in ONE transaction, so it is already all-or-nothing: an
 * abort would add a second mechanism for a property the transaction already has, at
 * the price of a half-applied purge being representable at all. `stoppable = false`
 * also means there is no `AbortSignal` to read, so there is no second read to get
 * wrong (`AGENTS.md` §3's `AbortController` argument, one layer up).
 *
 * ## THE IDEMPOTENCY IS THE DELETE'S
 *
 * A window comparison and a delete: running it twice inside one window changes
 * nothing, and the second run finds nothing to delete. The runner records no
 * "this ran" marker, so a job killed mid-body is re-run from the beginning by the
 * next process that gets the lock — and this body is safe to re-run, which is the
 * property the runner requires of every body it runs.
 */
@Injectable()
export class ConsentPurge implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ConsentPurge.name);

  constructor(
    @Inject(RETENTION_ENV) private readonly env: RetentionEnvironment,
    private readonly gate: BreakerGate,
    @Inject(SharedDatabasePool) private readonly pool: DatabaseConnectionSource,
    private readonly jobs: JobRunner,
  ) {}

  onApplicationBootstrap(): void {
    // Through the runner, which owns the only `setInterval` that runs a JOB in
    // `src/` (the breaker's two are per-instance instruments, not jobs): the
    // interval cannot reach a sweep without the sweep having taken `consent.purge`'s
    // advisory lock on a dedicated connection, so a second instance skips with a
    // reason instead of deleting the same rows beside this one.
    this.jobs.schedule(CONSENT_PURGE, this.env.consentPurgeIntervalSeconds, () => this.tick());
    this.logger.log(
      `consent.purge expires orphaned consent records older than ${String(this.env.tombstoneDays)} day(s) ` +
        `every ${String(this.env.consentPurgeIntervalSeconds)}s`,
    );
  }

  onModuleDestroy(): void {
    this.jobs.stop(CONSENT_PURGE);
  }

  /**
   * One sweep.
   *
   * `nowMs` is a VALUE rather than a clock call inside the work, for the reason
   * `breaker-state.ts` exists: a test that has to wait for wall time to cross a
   * window boundary is a test that will pass on the wrong side of it.
   */
  async tick(nowMs: number = Date.now()): Promise<ConsentPurgeRun> {
    const admission = this.gate.acquire(CONSENT_PURGE, false, nowMs);
    if (!admission.admit) {
      this.logger.warn(`consent.purge gated: ${admission.refusal}`);
      return { ran: false, outcome: 'gated' };
    }
    const lease = admission.lease;
    try {
      const removed = await this.purge();
      // `completed` and not `succeeded`: a sweep that found nothing has done the
      // whole of its work, and reporting it as a probe outcome would move the
      // breaker on an idle run.
      lease.release('completed');
      // Every sweep is logged, INCLUDING the empty ones. `removed 0` is the shape of
      // a sweep that is working and has nothing to do, and it is also the shape of a
      // sweep that has silently died — one line a day is the difference between
      // those two being distinguishable from the log (§2.3).
      this.logger.log(`consent.purge removed ${String(removed)} expired consent record(s)`);
      return { ran: true, removed };
    } catch (error) {
      lease.release('failed');
      throw error;
    }
  }

  /**
   * The delete, in ONE transaction.
   *
   * `SET LOCAL ROLE app_admin` before anything, and it is doing the half nothing
   * else can: `EXECUTE` on `authz.purge_expired_consent_records()` is granted to
   * `app_admin` and to nobody else, and the function itself is `SECURITY DEFINER`
   * because the append-only guard refuses a `DELETE` whose `current_user` is not the
   * table owner. Claims alone cannot buy either — the admin branch of a policy
   * discriminates on `current_user` and never on a token field (`AGENTS.md` §B2).
   *
   * **No claims document is set here**, and none is anywhere in this tree. The one
   * identity this job could have invented for itself — `request.jwt.claims` — is a
   * custom GUC any role may `SET` (`AGENTS.md` §B2 F1), and a retention job that
   * wrote its own would be exactly that path, standing.
   */
  private async purge(): Promise<number> {
    const client: PoolClient = await this.pool.connect();
    let settled = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const result = await client.query<{ readonly removed: number }>(PURGE_EXPIRED_CONSENT_RECORDS_SQL, [
        this.env.tombstoneDays,
      ]);
      const removed = result.rows[0]?.removed ?? 0;

      await client.query('COMMIT');
      settled = true;
      return removed;
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
