import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { PURGE_ENQUEUER, PURGE_SWEEPER } from '../../../src/breaker/dispatch-token.js';
import { SCHEDULER_LOCK_NAMESPACE, schedulerLockKeyFor } from '../../../src/scheduler/advisory-lock-key.js';
import { JobRunner } from '../../../src/scheduler/job-runner.service.js';
import { gate } from '../../support/breaker-harness.js';
import { loadTestEnvironment } from '../../support/database.js';

/**
 * **The advisory lock, against a real PostgreSQL.**
 *
 * `AGENTS.md` §2.2 forbids a stand-in for a real integration, and a lock is
 * precisely the thing a stand-in would fake: exclusivity is a property of the
 * SERVER's session table, not of anything the client believes. A fake pool here
 * would answer `true` to whatever the implementation asserted and the suite would be
 * a comment with a green tick.
 *
 * So these tests open real connections, take real locks, and read the answers back.
 * They touch no table — an advisory lock is session state — so nothing is created,
 * nothing is seeded, and nothing needs cleaning up. What is left over is closed in
 * `afterEach`, which matters for one reason: a lock left held by a failed case would
 * make the NEXT case fail for a reason that has nothing to do with it.
 */
const opened: Client[] = [];

afterEach(async () => {
  await Promise.all(
    opened.splice(0).map(async (client) => {
      await client.end().catch(() => undefined);
    }),
  );
});

/** A dedicated `pg.Client`, which is the only shape a session-scoped lock survives. */
async function dedicatedClient(): Promise<Client> {
  const env = loadTestEnvironment();
  const client = new Client({
    host: env.database.host,
    port: env.database.port,
    user: env.authenticator.user,
    password: env.authenticator.password,
    database: env.database.database,
  });
  await client.connect();
  opened.push(client);
  return client;
}

async function tryLock(client: Client, name: string): Promise<boolean> {
  const answer = await client.query<{ readonly acquired: boolean }>(
    'SELECT pg_try_advisory_lock($1, $2) AS acquired',
    [SCHEDULER_LOCK_NAMESPACE, schedulerLockKeyFor(name)],
  );
  return answer.rows[0]?.acquired === true;
}

/** The shipped runner, over the validated `.env.test` environment. */
function jobRunner(): JobRunner {
  return new JobRunner(new ConfigService({ environment: loadTestEnvironment() }), new SchedulerRegistry());
}

describe('the advisory lock is exclusive across connections', () => {
  it('gives the key to one connection and refuses it to the second, and gives it up on release', async () => {
    // THE assertion this unit exists for. Two real sessions, one key: the second is
    // refused while the first holds it, and admitted once the first releases — which
    // is the whole of "exactly one instance runs the job".
    const first = await dedicatedClient();
    const second = await dedicatedClient();

    expect(await tryLock(first, PURGE_SWEEPER)).toBe(true);
    expect(await tryLock(second, PURGE_SWEEPER), 'two sessions held the same job key').toBe(false);

    await first.query('SELECT pg_advisory_unlock($1, $2)', [
      SCHEDULER_LOCK_NAMESPACE,
      schedulerLockKeyFor(PURGE_SWEEPER),
    ]);

    expect(await tryLock(second, PURGE_SWEEPER), 'the released key was not available to the other session').toBe(true);
  });

  it('does not let one job block another, because the key is derived per job', async () => {
    const held = await dedicatedClient();
    expect(await tryLock(held, PURGE_SWEEPER)).toBe(true);

    // Two retention jobs on the same instance must not take turns for the lock: the
    // enqueuer fills the queue the sweeper drains, and one blocking the other is a
    // throughput bug with a plausible-looking log line.
    expect(await tryLock(held, PURGE_ENQUEUER)).toBe(true);
  });

  it('leaves no lock behind when a session dies without releasing one', async () => {
    // Crash-safety, stated as a measurement rather than as a claim. A session-scoped
    // lock is released by the SERVER when the socket closes, so a killed instance
    // leaves nothing to clean up — which is the reason this mechanism was chosen over
    // a lease table.
    const dying = await dedicatedClient();
    expect(await tryLock(dying, PURGE_SWEEPER)).toBe(true);

    await dying.end(); // No unlock: this is what a process death looks like.

    const survivor = await dedicatedClient();
    expect(await tryLock(survivor, PURGE_SWEEPER), 'a dead session kept the lock').toBe(true);
  });
});

describe('a second "instance" does not run the same job', () => {
  it('runs one body and skips the other, and the skip says why', async () => {
    // Two concurrent invocations of the wrapper against ONE database: the shape two
    // processes produce when their intervals line up. The body is parked on a promise
    // so the first invocation is still holding its lock when the second arrives —
    // without that, the two would serialise by luck and this test would pass against
    // an implementation with no lock at all.
    const held = gate();
    let reachedInside = (): void => undefined;
    const inside = new Promise<void>((resolve) => {
      reachedInside = resolve;
    });
    let executions = 0;
    const body = async (): Promise<string> => {
      executions += 1;
      reachedInside();
      await held.open;
      return 'swept';
    };

    const jobs = jobRunner();
    const first = jobs.runExclusive(PURGE_SWEEPER, body);
    await inside;

    const second = await jobs.runExclusive(PURGE_SWEEPER, body);
    held.release();
    const winner = await first;

    expect(winner).toEqual({ ran: true, value: 'swept' });
    expect(second.ran, 'the second invocation reported that it ran').toBe(false);
    // The count is the assertion, not the summaries: a wrapper that ran the body and
    // then reported a skip would satisfy both summary checks and be exactly the defect
    // this suite exists to catch.
    expect(executions).toBe(1);
    if (!second.ran) {
      expect(second.skipReason).toContain(PURGE_SWEEPER);
    }
  });

  it('lets the next invocation run once the first has finished, rather than skipping forever', async () => {
    // The other direction of the same trap: a lock released only on success, or never
    // released at all, produces a job that is permanently unable to run and logs a
    // skip line every interval — which looks like a busy neighbour.
    const jobs = jobRunner();
    await expect(jobs.runExclusive(PURGE_SWEEPER, () => Promise.resolve('first'))).resolves.toEqual({
      ran: true,
      value: 'first',
    });
    await expect(jobs.runExclusive(PURGE_SWEEPER, () => Promise.resolve('second'))).resolves.toEqual({
      ran: true,
      value: 'second',
    });
  });
});

describe('the lock is released after the body, including when the body throws', () => {
  it('is free for the next run after a body that succeeded', async () => {
    await expect(jobRunner().runExclusive(PURGE_SWEEPER, () => Promise.resolve(7))).resolves.toEqual({
      ran: true,
      value: 7,
    });

    expect(await tryLock(await dedicatedClient(), PURGE_SWEEPER), 'a successful run left its lock held').toBe(true);
  });

  it('is free for the next run after a body that threw, because a re-run IS the retry', async () => {
    // A release in the success path only would turn one failure into a job that can
    // never run again — and the symptom is a warn line a reader would blame on a
    // neighbour instance rather than on this process.
    const boom = new Error('the drain failed');

    await expect(
      jobRunner().runExclusive(PURGE_SWEEPER, () => Promise.reject(boom)),
    ).rejects.toThrow(boom);

    expect(await tryLock(await dedicatedClient(), PURGE_SWEEPER), 'a failed run left its lock held').toBe(true);
  });

  it('does not report a skip as a success, because the caller has to be able to tell', async () => {
    // `§2.3`: a job that did not happen must not answer in a success shape. The union
    // in `ScheduledRun` is what makes that unrepresentable rather than merely
    // documented, and this is the assertion that the arms are distinguishable.
    const held = gate();
    let reachedInside = (): void => undefined;
    const inside = new Promise<void>((resolve) => {
      reachedInside = resolve;
    });
    const jobs = jobRunner();
    const first = jobs.runExclusive(PURGE_SWEEPER, async () => {
      reachedInside();
      await held.open;
      return 'swept';
    });
    await inside;

    const skipped = await jobs.runExclusive(PURGE_SWEEPER, () => Promise.resolve('swept'));
    held.release();
    await first;

    expect(skipped.ran).toBe(false);
    if (skipped.ran) {
      expect.unreachable('the second invocation ran while the first held the lock');
    }
    expect(skipped.skipReason).toContain('another instance');
  });
});

describe('registration, which is the only way an interval reaches a job', () => {
  it('registers one named interval per job and clears it on stop', () => {
    // `SchedulerRegistry.addInterval` throws on a duplicate name, so this is also the
    // evidence that a job cannot silently end up with two.
    const registry = new SchedulerRegistry();
    const jobs = new JobRunner(new ConfigService({ environment: loadTestEnvironment() }), registry);

    jobs.schedule(PURGE_SWEEPER, 3600, () => Promise.resolve());
    expect(registry.getIntervals()).toEqual([PURGE_SWEEPER]);
    expect(() => jobs.schedule(PURGE_SWEEPER, 3600, () => Promise.resolve())).toThrow(/already scheduled/);

    jobs.stop(PURGE_SWEEPER);
    expect(registry.getIntervals()).toEqual([]);
    // …and stopping a name that is not scheduled is not an error, because Nest calls
    // a destroy hook on both app-close and module-close.
    expect(() => jobs.stop(PURGE_SWEEPER)).not.toThrow();
  });

  it('clears every registered interval when the runner itself is destroyed', () => {
    // The runner is a singleton every job shares, so it is the one place that knows
    // what is still running — and a `setInterval` left behind keeps a process alive
    // long after its jobs stopped.
    const registry = new SchedulerRegistry();
    const jobs = new JobRunner(new ConfigService({ environment: loadTestEnvironment() }), registry);

    jobs.schedule(PURGE_SWEEPER, 3600, () => Promise.resolve());
    jobs.schedule(PURGE_ENQUEUER, 3600, () => Promise.resolve());

    jobs.onModuleDestroy();
    expect(registry.getIntervals()).toEqual([]);
  });
});