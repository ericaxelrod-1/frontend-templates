import { Client } from 'pg';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { DispatchToken } from '../breaker/dispatch-token.js';
import type { Environment } from '../config/environment.js';
import { SCHEDULER_LOCK_NAMESPACE, schedulerLockKeyFor } from './advisory-lock-key.js';

/**
 * What one execution of a job did, and — the half that matters — whether it did it
 * at all.
 *
 * A union rather than a value with optional fields, because `ran: false` with a
 * `value` nobody can produce is exactly the shape a caller would read as success:
 * `§2.3` says a job that did not happen must not report a success-shaped result, and
 * that starts at the type. Reading `skipReason` is a compile error on the arm that
 * skipped nothing.
 */
export type ScheduledRun<T> =
  | { readonly ran: true; readonly value: T }
  | { readonly ran: false; readonly skipReason: string };

/** The row the two lock statements below answer with. */
type LockAnswer = { readonly pg_advisory_unlock?: boolean; readonly acquired?: boolean };

/**
 * **The one place a scheduled job runs.**
 *
 * Everything about a job that is not its business — when it fires, who may fire it,
 * what a failure looks like — is settled here, so the next job cannot answer any of
 * those questions differently.
 *
 * ## The lock is the whole of the "exactly one instance" property
 *
 * `SELECT pg_try_advisory_lock(…)` on a stable key derived from the job's name. One
 * instance, two, ten: exactly one proceeds, and the rest report a skip with a reason
 * rather than silently doing nothing. **There is no `SCHEDULER_ENABLED` flag**, and
 * that absence is the design: a flag invites "I turned it off and forgot", and a
 * retention sweep that has silently stopped is worse than a process that is visibly
 * dead. The lock is self-enforcing — nothing to configure, nothing to remember, and
 * no way for two deployments to disagree about whether the scheduler is on.
 *
 * ## Why the lock is taken on a DEDICATED connection, and not through PostgREST
 *
 * **Advisory locks are session-scoped**, and the two connections this application
 * could reach Postgres on are both the wrong shape:
 *
 *   * **Not PostgREST.** It is an HTTP API in another process, it pools the database
 *     connections it does not expose, and it closes a backend when a transaction
 *     ends. A lock taken inside one request dies with that request: it is held for
 *     microseconds instead of for the job, and the "release" nobody performs happens
 *     because the socket closes. Both halves of the guarantee would be false and
 *     neither would raise — a second instance would start the same job while the
 *     first is still running, which is the one outcome this unit exists to prevent.
 *     There is no PostgREST operation that pins a session, and building one would be
 *     a new mechanism for a job that can simply open its own connection.
 *   * **Not the shared pool.** `SharedDatabasePool.connect()` borrows a
 *     `PoolClient` and `release()` returns it to the pool with its session intact,
 *     so the lock would outlive the job and block the next run of that job until the
 *     idle timeout eventually closed the socket — a job that runs once an hour would
 *     hold its own lock for a minute and report itself as unable to run. Whether the
 *     body returns the connection early, whether the transaction it opened is still
 *     open, and whether the pool decides to recycle the socket are all things the
 *     job does not control and all of them decide when the lock is released.
 *
 * So the runner opens **one `pg.Client` per execution and holds it for the whole
 * execution**, and there is no way to reach the body without one open. The cost is
 * a connection per running job — bounded by the number of jobs, which is a handful,
 * and it is charged to `DATABASE_POOL_MAX`'s budget only while a job is actually
 * running rather than all the time.
 *
 * **It is crash-safe because it is session-scoped.** A killed instance's socket
 * closes, Postgres releases its locks, and the next process to try finds the key
 * free: there is no lease, no `locked_at` column, no reaper and nothing to clean up.
 * A stale lock is not a state this design can produce.
 *
 * ## Every job body must be idempotent — a restart re-runs it
 *
 * **Nothing here records that a run happened**, so a job killed mid-body is re-run
 * from the beginning by the next process that gets the lock. That is deliberate: the
 * bookkeeping table which would let a job skip its re-run is a second mechanism for
 * "is this job running", it has to be reconciled with the lock, and it can disagree
 * with it after a crash (the row says `running`, the lock says nobody is home). So
 * the constraint is pushed onto the body instead, and it is stated here because this
 * is the file the next person writing a job reads:
 *
 *   * writing the same derived row twice must be the same as writing it once
 *     (`INSERT … ON CONFLICT DO NOTHING`, a partial UNIQUE index, an idempotent
 *     `DELETE … WHERE`), never a second copy;
 *   * a job that enqueues must not be able to enqueue twice for one event;
 *   * the retention sweep already satisfies this — it is a window comparison and a
 *     queue insert, and the same run inside one window changes nothing;
 *   * the notification materializers (next unit) must satisfy it too, and the
 *     constraint above is what shapes them.
 *
 * ## The watermark and the overlap window — for the materializers, not here
 *
 * A delta-based materializer needs **both** halves of a cursor, and this is the file
 * that says so while the next unit is being written:
 *
 *   * **a watermark** — the newest source record's own timestamp — says how far the
 *     last run got;
 *   * **an overlap window** — read back a margin BEHIND that watermark rather than
 *     from it — is what makes downtime survivable.
 *
 * **A pure timestamp watermark silently drops every backdated record.** A row that
 * arrives late, with a `created_at` older than the watermark, is behind the cursor
 * and is never materialised again; nothing errors, nothing is logged, and the
 * notification simply does not exist — a missing row that reads exactly like a
 * correct one. Reading with an overlap and making the write idempotent turns that
 * silent loss into at worst a duplicate write, which is why idempotence above and
 * overlap here are the same decision.
 *
 * Neither half is implemented in this unit: there is no notification table to
 * materialise and inventing a cursor for a job that does not exist would be a
 * watermark nothing reads.
 *
 * ## Where intervals come from
 *
   * `schedule()` takes the interval as a required argument and holds no default, so a
   * job cannot invent one — every interval in `src/` reaches a `setInterval` as a
   * value read from configuration at module-evaluation time. **This file owns the
   * only `setInterval` in `src/` that runs a JOB.** The other two are the breaker's
   * per-instance instruments in `breaker-gate.ts` and `breaker-meter.ts`, and they
   * must stay outside the lock: a breaker is supposed to run on every instance at
   * once, so an advisory lock per poll would serialise it across instances and
   * spend a database connection on every poll.
   * `test/unit/scheduler/job-interval-source.spec.ts` asserts the file set against
   * the source tree rather than trusting the sentence above it.
 */
@Injectable()
export class JobRunner implements OnModuleDestroy {
  private readonly logger = new Logger(JobRunner.name);
  private readonly env: Environment;
  private readonly timers = new Map<DispatchToken, NodeJS.Timeout>();

  constructor(
    config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    // The one validated `Environment`, never a second read of `process.env`
    // (`§2.3`: no config key read with a default that masks a missing namespace).
    this.env = config.getOrThrow<Environment>('environment');
  }

  /**
   * Register `body` to run every `intervalSeconds`, under this job's lock.
   *
   * The timer is `unref`'d (a scheduler must not be the reason a process refuses to
   * exit) and registered in `SchedulerRegistry` under the job's dispatch token, so
   * the running intervals are inspectable and `onModuleDestroy` can clear every one
   * of them whether or not a job remembered to.
   *
   * `SchedulerRegistry.addInterval` throws on a duplicate name, which is the
   * behaviour wanted here: two registrations for one job is a bug, and silently
   * replacing the first would leave one interval running that nobody can name.
   */
  schedule(name: DispatchToken, intervalSeconds: number, body: () => Promise<unknown>): void {
    if (this.timers.has(name)) {
      throw new Error(`job ${name} is already scheduled: one name, one interval, one body.`);
    }
    const intervalMs = intervalSeconds * 1000;
    const timer = setInterval(() => {
      // The scheduler boundary is where a rejection becomes a log line rather than an
      // unhandled one. `runExclusive` has already logged it with the job name and the
      // duration it took; this catch is here so a failing job is not an unhandled
      // rejection, and it is not a second report.
      void this.runExclusive(name, body).catch(() => undefined);
    }, intervalMs);
    timer.unref();
    this.timers.set(name, timer);
    this.scheduler.addInterval(name, timer);
    this.logger.log(`job ${name} runs every ${String(intervalSeconds)}s (pid ${String(process.pid)})`);
  }

  /** Stop one job. A name that is not scheduled is not an error. */
  stop(name: DispatchToken): void {
    const timer = this.timers.get(name);
    this.timers.delete(name);
    if (timer !== undefined) {
      clearInterval(timer);
    }
    if (this.scheduler.doesExist('interval', name)) {
      this.scheduler.deleteInterval(name);
    }
  }

  /**
   * Everything registered here is cleared on shutdown, whether or not each job
   * implements its own teardown. `pg.Pool` holds idle sockets open enough to keep a
   * process alive, and a `setInterval` does the same for longer; a runner that
   * outlives its jobs is a process that does not exit cleanly.
   */
  onModuleDestroy(): void {
    for (const name of [...this.timers.keys()]) {
      this.stop(name);
    }
  }

  /**
   * Run `body` once, under `name`'s advisory lock, on a dedicated connection.
   *
   * Returns `{ ran: false, skipReason }` — rather than throwing — when another
   * instance holds the lock: a competing instance is the expected steady state of a
   * multi-instance deployment, not an error, and the reason is returned so the caller
   * can log or count it. A failure inside `body` is rethrown after the lock is
   * released, because that is a real failure (§2.3).
   */
  async runExclusive<T>(name: DispatchToken, body: () => Promise<T>): Promise<ScheduledRun<T>> {
    const key = schedulerLockKeyFor(name);
    // `pgrst_authenticator`, the same escalation boundary every writer in this
    // application crosses — and the only LOGIN role a scheduled job can be. The lock
    // itself needs no privileges; the credential is here so this connection is the
    // same kind of connection the rest of the machine opens.
    const client = new Client({
      host: this.env.database.host,
      port: this.env.database.port,
      user: this.env.authenticator.user,
      password: this.env.authenticator.password,
      database: this.env.database.database,
    });
    await client.connect();
    try {
      const attempt = await client.query<LockAnswer>('SELECT pg_try_advisory_lock($1, $2) AS acquired', [
        SCHEDULER_LOCK_NAMESPACE,
        key,
      ]);
      if (attempt.rows[0]?.acquired !== true) {
        const skipReason = `another instance holds the lock for ${name}`;
        this.logger.warn(`job ${name} skipped: ${skipReason}`);
        return { ran: false, skipReason };
      }

      const startedAtMs = Date.now();
      this.logger.log(`job ${name} started (pid ${String(process.pid)})`);
      try {
        const value = await body();
        this.logger.log(`job ${name} finished in ${String(Date.now() - startedAtMs)}ms`);
        return { ran: true, value };
      } catch (error) {
        this.logger.error(
          `job ${name} failed after ${String(Date.now() - startedAtMs)}ms: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      } finally {
        // Released on every path, including the throwing one: a lock released only
        // on success is a job that cannot run again after one failure, and the
        // re-run is the retry. Closing the connection would release it too — this is
        // belt-and-braces on purpose, because the claim this file makes is that the
        // release is in a `finally`, and that claim should be readable.
        await this.release(client, name, key);
      }
    } finally {
      await client.end();
    }
  }

  /**
   * `pg_advisory_unlock` answers `false` when this session did not hold the key, and
   * that is a fact worth saying out loud rather than ignoring: it means the lock was
   * gone while the body was running — the connection was recycled, or something else
   * released it — so two instances may have run this job at once.
   */
  private async release(client: Client, name: DispatchToken, key: number): Promise<void> {
    const released = await client.query<LockAnswer>('SELECT pg_advisory_unlock($1, $2) AS pg_advisory_unlock', [
      SCHEDULER_LOCK_NAMESPACE,
      key,
    ]);
    if (released.rows[0]?.pg_advisory_unlock !== true) {
      this.logger.warn(`job ${name} released no lock: this session did not hold it`);
    }
  }
}