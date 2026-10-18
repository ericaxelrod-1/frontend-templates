import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_DISPATCH_TOKENS, PURGE_ENQUEUER } from '../../../src/breaker/dispatch-token.js';
import { PurgeEnqueuer } from '../../../src/purge/purge-enqueuer.service.js';
import type { RetentionEnvironment } from '../../../src/purge/retention-environment.js';
import { gate, scriptedPool, TRIP_ENV, T0, tripHarness } from '../../support/breaker-harness.js';
import { BACKEND_ROOT } from '../../support/paths.js';
import type { ScriptedPool, TripHarness } from '../../support/breaker-harness.js';

/**
 * **The enqueuer's CONTROL path, executed.**
 *
 * `test/rls/purge-machine-path.spec.ts` proves the SQL: that
 * `authz.enqueue_inactive_purges()` writes what it says and that
 * `authz.retention_due_tombstones()` selects what it says. **None of that is
 * scheduling.** Whether a tick overlaps a still-running tick, whether the latch
 * survives a failure, whether a stoppable lease is actually stopped, and whether
 * an abort is honoured rather than merely received — none of those is visible from
 * a database, and all of them are the class of defect that reached `main` earlier
 * in this workstream: the data path was tested and the control path was not.
 *
 * So this file drives the **real** `PurgeEnqueuer` against the **real** gate
 * through the shared trip-path harness (`test/support/breaker-harness.ts` — the
 * one `breaker-trip-path.spec.ts` also uses, not a second copy), and the only
 * thing standing in for the outside world is the `pg` client, which the design
 * already made a narrow port for.
 *
 * ## What each assertion is really about
 *
 * | assertion | the defect it would miss |
 * |---|---|
 * | an overrunning tick refuses a second concurrent tick | two scans race, two `INSERT`s, one half-built queue |
 * | the latch is released when the tick **fails** | a job that threw once never runs again — the other direction of the same latch |
 * | a gated breaker reaches no connection at all | "shed the work" implemented as "run it more slowly" |
 * | a stopped sweep rolls back and reports `aborted` | a stoppable lease that takes a signal and ignores it — the `AbortController` defect one layer up |
 * | an aborted probe re-opens the breaker | the half-open probe reporting success for work that did not happen |
 */

/**
 * The windows are a decision and the interval is a scheduling fact; this suite
 * asserts scheduling, and neither of their values. The interval used to be a
 * constant in the service (`RETENTION_ENQUEUE_INTERVAL_SECONDS`); it is read from
 * configuration now, and the same number here keeps the tick-staleness arithmetic in
 * the latch test below honest.
 */
const ENV: RetentionEnvironment = {
  tombstoneDays: 1825,
  inactiveAccountDays: 1095,
  enqueueIntervalSeconds: 3600,
};

const USER_A = '00000000-0000-0000-0000-0000000000a1';
const USER_B = '00000000-0000-0000-0000-0000000000a2';

type Answer = { readonly when: (statement: string) => boolean; readonly results: readonly { readonly rows: unknown[]; readonly rowCount: number | null }[] };

const SCAN = 'authz.retention_due_tombstones';
const ENQUEUE = 'authz.enqueue_inactive_purges';

/**
 * TWO due tombstones, and an enqueue that writes both.
 *
 * The rows carry the reason the DATABASE returned, because that is what
 * `splitByPopulation()` sorts on: a scripted row with no `reason` is a due row the
 * application cannot classify, and it raises rather than guessing. `USER_B` is a
 * dormant LIVE account under the other code, so the fixture covers both arrays the
 * enqueue takes and the sweep's `scanned` counts across populations rather than
 * within one.
 */
const TWO_DUE: readonly Answer[] = [
  {
    when: (statement) => statement.includes(SCAN),
    results: [
      {
        rows: [
          { user_id: USER_A, reason: 'inactivity_purge' },
          { user_id: USER_B, reason: 'inactive_account_purge' },
        ],
        rowCount: 2,
      },
    ],
  },
  {
    when: (statement) => statement.includes(ENQUEUE),
    results: [{ rows: [{ enqueue_inactive_purges: 2 }], rowCount: 1 }],
  },
];

/** Nothing due: the sweep still runs and still commits a transaction. */
const NOTHING_DUE: readonly Answer[] = [
  { when: (statement) => statement.includes(SCAN), results: [{ rows: [], rowCount: 0 }] },
];

/**
 * A gate that has published a reading at `percent`, and the job hung off it.
 *
 * The meter is ticked here rather than in each test so that no test's clock is a
 * side effect of a shared helper the reader has to scroll up to find.
 */
async function armed(percent: number, pool: ScriptedPool): Promise<{ readonly harness: TripHarness; readonly enqueuer: PurgeEnqueuer }> {
  const harness = tripHarness(TRIP_ENV);
  await harness.meterAt(percent).tick(T0);
  return { harness, enqueuer: new PurgeEnqueuer(ENV, harness.gate, pool.source, harness.jobs) };
}

/** Index of the first statement containing `fragment`, or -1. */
function at(statements: readonly string[], fragment: string): number {
  return statements.findIndex((statement) => statement.includes(fragment));
}

/** A pool whose scan parks until released, and a promise that resolves once it is reached. */
function poolHeldAtTheScan(): { readonly pool: ScriptedPool; readonly scanned: Promise<void>; readonly release: () => void } {
  const held = gate();
  let reached: () => void = () => undefined;
  const scanned = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const pool = scriptedPool(TWO_DUE, {
    block: { when: (statement) => statement.includes(SCAN), until: held.open },
    onStatement: (statement) => {
      if (statement.includes(SCAN)) {
        reached();
      }
    },
  });
  return { pool, scanned, release: held.release };
}

describe('the enqueuer is a named dispatch site, and deliberately not a protected one', () => {
  it('has a token in the shared vocabulary rather than passing undefined to the gate', () => {
    // `undefined` was fail-closed and also undocumented: it is the gate's "this
    // build cannot name this site" answer, so the job was *unnamed* rather than
    // shedding for a stated reason.
    expect(PURGE_ENQUEUER).toBe('purge.enqueuer');
    expect(KNOWN_DISPATCH_TOKENS).toContain(PURGE_ENQUEUER);
  });

  it('is NOT in BREAKER_PROTECTED, in ANY mode, because shedding batch work with nobody waiting is what shedding is for', () => {
    // Every one of the six protected tokens is request-path work or the instrument
    // itself. The enqueuer is hourly batch work: deferring NEW enqueues under
    // memory pressure is correct, and the sweeper keeps draining whatever is
    // already queued. **Adding `purge.enqueuer` to a protected list would make a
    // job nobody is waiting on run through a memory crisis to produce more work
    // for a job that is being held back.**
    //
    // Read from the `.env*` files rather than from the harness constant, because a
    // test that asserts against the same literal the code uses proves nothing:
    // the way someone would "fix" this omission is to type the token into a `.env`
    // file, and this is what makes that a RED test rather than a silent decision.
    const files = readdirSync(BACKEND_ROOT).filter((name) => name === '.env' || name.startsWith('.env.'));
    expect(files.length, 'no .env* files were found; this assertion would be vacuous').toBeGreaterThanOrEqual(6);

    for (const file of files) {
      const source = readFileSync(join(BACKEND_ROOT, file), 'utf8');
      const assigned = source
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('BREAKER_PROTECTED='));
      expect(assigned, `${file} does not assign BREAKER_PROTECTED`).toHaveLength(1);
      expect(assigned[0], `${file} protects purge.enqueuer`).not.toContain(PURGE_ENQUEUER);
    }
  });
});

describe('the latch: one sweep at a time', () => {
  it('refuses a second tick while the first is still running, so a tick that overruns its interval cannot overlap', async () => {
    const held = poolHeldAtTheScan();
    const harness = tripHarness(TRIP_ENV);
    await harness.meterAt(10).tick(T0);
    const enqueuer = new PurgeEnqueuer(ENV, harness.gate, held.pool.source, harness.jobs);

    const first = enqueuer.tick(T0);
    await held.scanned;

    // The interval fires while the first sweep is still in flight. The meter
    // publishes at that instant too, because a gate would otherwise refuse the
    // second tick as STALE — which would make this test pass with no latch at all,
    // for the wrong reason. The tick under test must be ADMISSIBLE, so that the
    // only thing stopping it is the latch.
    const intervalMs = ENV.enqueueIntervalSeconds * 1000;
    await harness.meterAt(10).tick(T0 + intervalMs);
    expect(harness.registry.get().mode).toBe('closed');

    // Called while the first sweep is still parked, and released immediately
    // afterwards: the latch check is the first statement of `tick()` and runs
    // synchronously, so releasing cannot retroactively un-latch the second tick.
    // Without the latch this is a REAL second sweep — two connections, two
    // scans, one queue — rather than a hang.
    const second = enqueuer.tick(T0 + intervalMs);
    held.release();

    await expect(first).resolves.toEqual({ scanned: 2, enqueued: 2, outcome: 'enqueued' });
    await expect(second).resolves.toEqual({ scanned: 0, enqueued: 0, outcome: 'nothing_due' });
    // One connection for the whole run. A second one IS a second concurrent sweep,
    // whatever the latch claims, so the assertion is the count and not the summary.
    expect(held.pool.connects()).toBe(1);
  });

  it('releases the latch when a tick THROWS, because a latch cleared only on success is a job that stopped', async () => {
    // The other direction of the same trap. If the latch leaked on a throw, the
    // second tick would return the skip summary above and this one would too, and
    // the retention job would be dead from its first failure onwards with nothing
    // in the log but a warn line about a sweep still running.
    const boom = new Error('the scan failed');
    const pool = scriptedPool(NOTHING_DUE, { raise: { when: (statement) => statement.includes(SCAN), error: boom } });
    const { enqueuer } = await armed(10, pool);

    await expect(enqueuer.tick(T0)).rejects.toThrow(boom);

    const second = enqueuer.tick(T0 + 1);
    await expect(second).rejects.toThrow(boom);
    // Two connections: the second tick was not skipped by a stuck latch.
    expect(pool.connects()).toBe(2);
  });
});

describe('GATE refuses the sweep before it opens a connection', () => {
  it('enqueues nothing and reaches no database at 99 %, which is what a dispatch decision means', async () => {
    const pool = scriptedPool(TWO_DUE);
    const { enqueuer } = await armed(99, pool);

    await expect(enqueuer.sweep(T0)).resolves.toEqual({ scanned: 0, enqueued: 0, outcome: 'gated' });
    expect(pool.connects()).toBe(0);
    expect(pool.statements()).toEqual([]);
  });

  it('runs the same sweep at 10 %, so the gated run above is a gate and not a dead job', async () => {
    const pool = scriptedPool(TWO_DUE);
    const { enqueuer } = await armed(10, pool);

    await expect(enqueuer.sweep(T0)).resolves.toEqual({ scanned: 2, enqueued: 2, outcome: 'enqueued' });
    expect(pool.connects()).toBe(1);
  });

  it('reports an empty sweep as its own outcome, inside a transaction that still commits', async () => {
    const pool = scriptedPool(NOTHING_DUE);
    const { enqueuer } = await armed(10, pool);

    await expect(enqueuer.sweep(T0)).resolves.toEqual({ scanned: 0, enqueued: 0, outcome: 'nothing_due' });

    const statements = pool.statements().map((statement) => statement.text);
    expect(at(statements, 'BEGIN')).toBeLessThan(at(statements, SCAN));
    expect(at(statements, SCAN)).toBeLessThan(at(statements, 'COMMIT'));
    // An empty sweep is the shape a working scan has AND the shape a dead one
    // has; the enqueue statement never running is what distinguishes them here.
    expect(at(statements, ENQUEUE)).toBe(-1);
  });
});

describe('STOP: a stoppable lease that is actually stopped', () => {
  it('rolls the whole transaction back when the abort arrives during the scan', async () => {
    const held = poolHeldAtTheScan();
    const { harness, enqueuer } = await armed(10, held.pool);

    const sweep = enqueuer.sweep(T0);
    await held.scanned;

    expect(harness.gate.liveStoppableCount()).toBe(1);
    expect(harness.gate.stopInFlight('memory pressure')).toBe(1);
    held.release();

    // The queue is unchanged, and the summary says so rather than reporting a
    // sweep that found two tombstones and did nothing about them.
    await expect(sweep).resolves.toEqual({ scanned: 2, enqueued: 0, outcome: 'aborted' });

    const statements = held.pool.statements().map((statement) => statement.text);
    expect(at(statements, ENQUEUE)).toBe(-1);
    expect(statements).not.toContain('COMMIT');
    expect(statements.filter((statement) => statement === 'ROLLBACK')).toHaveLength(1);
  });

  it('rolls back even when the abort arrives after the INSERT, so a stop is never a half-commit', async () => {
    // The second check, and the one an operator cares about: an abort that lands
    // during the write must undo the write. Without it the summary reports
    // `aborted` over a queue that gained every row anyway — §2.3's success-shaped
    // lie in its most literal form.
    const held = gate();
    let reached: () => void = () => undefined;
    const inserted = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const pool = scriptedPool(TWO_DUE, {
      block: { when: (statement) => statement.includes(ENQUEUE), until: held.open },
      onStatement: (statement) => {
        if (statement.includes(ENQUEUE)) {
          reached();
        }
      },
    });
    const { harness, enqueuer } = await armed(10, pool);

    const sweep = enqueuer.sweep(T0);
    await inserted;
    expect(harness.gate.stopInFlight('memory pressure')).toBe(1);
    held.release();

    await expect(sweep).resolves.toEqual({ scanned: 2, enqueued: 0, outcome: 'aborted' });

    const statements = pool.statements().map((statement) => statement.text);
    // The write DID happen and was undone. Asserting that it never happened would
    // be the weaker test: the guarantee is that it did not SURVIVE.
    expect(at(statements, ENQUEUE)).toBeGreaterThan(-1);
    expect(statements).not.toContain('COMMIT');
    expect(at(statements, ENQUEUE)).toBeLessThan(statements.lastIndexOf('ROLLBACK'));
  });

  it('leaves nothing live once a stopped sweep releases its lease', async () => {
    // Aborting is a signal, not a cancellation: the lease stays live until its
    // owner releases it, so a stopped job that never released it would make every
    // later `stopInFlight` count a phantom.
    const { harness, enqueuer } = await armed(10, scriptedPool(TWO_DUE));

    const sweep = enqueuer.sweep(T0);
    // `acquire` is the first statement in `sweep`, so the lease already exists.
    expect(harness.gate.stopInFlight('test')).toBe(1);
    await sweep;

    expect(harness.gate.liveStoppableCount()).toBe(0);
  });
});

describe('the half-open probe interaction', () => {
  it('admits the enqueuer as the single probe after the cooldown, and an aborted probe re-opens the breaker', async () => {
    const held = poolHeldAtTheScan();
    const harness = tripHarness(TRIP_ENV);
    await harness.meterAt(99).tick(T0);
    expect(harness.registry.get().mode).toBe('open');
    const enqueuer = new PurgeEnqueuer(ENV, harness.gate, held.pool.source, harness.jobs);

    expect(harness.gate.acquire(PURGE_ENQUEUER, true, T0).admit).toBe(false);

    // Settled: past the cooldown AND below yellow.
    await harness.meterAt(20).tick(T0 + 200_000);
    expect(harness.registry.get().mode).toBe('half_open');

    const sweep = enqueuer.sweep(T0 + 200_000);
    await held.scanned;

    // The probe is in flight, so every other dispatch is held — one half-open
    // admission for the whole process, not one per job.
    expect(harness.gate.acquire(PURGE_ENQUEUER, true, T0 + 200_001).admit).toBe(false);

    expect(harness.gate.stopInFlight('memory pressure')).toBe(1);
    held.release();
    const summary = await sweep;

    // An aborted probe is a probe that reported failure, so the breaker re-opens.
    // A probe released as `completed` here would close the breaker over a sweep
    // that enqueued nothing — the most expensive kind of false green.
    expect(summary.outcome).toBe('aborted');
    expect(harness.registry.get().mode).toBe('open');
    expect(harness.registry.get().probeInFlight).toBe(false);
  });

  it('closes the breaker when the probe enqueued something, because that is what a probe reports', async () => {
    const harness = tripHarness(TRIP_ENV);
    await harness.meterAt(99).tick(T0);
    await harness.meterAt(20).tick(T0 + 200_000);
    const enqueuer = new PurgeEnqueuer(ENV, harness.gate, scriptedPool(TWO_DUE).source, harness.jobs);

    await expect(enqueuer.sweep(T0 + 200_000)).resolves.toMatchObject({ enqueued: 2 });
    expect(harness.registry.get().mode).toBe('closed');
    expect(harness.registry.get().openedAtMs).toBeNull();
  });
});

describe('the job registers and clears exactly one interval', () => {
  it('uses the dispatch token as the registry key, so the job has one name', async () => {
    // It used to export a second name for the same job (`retention.enqueuer`), so
    // the gate refused `purge.enqueuer` in one vocabulary while the scheduler
    // listed `retention.enqueuer` in another and the log line said a third thing.
    const { harness, enqueuer } = await armed(10, scriptedPool(NOTHING_DUE));

    enqueuer.onApplicationBootstrap();
    expect(harness.scheduler.getIntervals()).toEqual([PURGE_ENQUEUER]);

    enqueuer.onModuleDestroy();
    expect(harness.scheduler.getIntervals()).toEqual([]);
  });
});