import { describe, expect, it } from 'vitest';
import { PurgeSweeper } from '../../../src/purge/purge-sweeper.service.js';
import type { BreakerEnvironment } from '../../../src/breaker/breaker-environment.js';
import type { PurgeExecutor } from '../../../src/purge/purge-executor.js';
import type { PurgeClaim } from '../../../src/purge/purge-claim.js';
import type { ScriptedPool } from '../../support/breaker-harness.js';
import { gate, scriptedPool, TRIP_ENV, T0, tripHarness } from '../../support/breaker-harness.js';
import type { TripHarness } from '../../support/breaker-harness.js';

/**
 * **The sweeper's CONTROL path: budget, latch and the half-open allowance.**
 *
 * `breaker-trip-path.spec.ts` already proves the trip path for this job — that a
 * gated drain reaches no database, and that an overrunning tick refuses a second
 * one — and it drives the same harness this file does. What it does **not** prove
 * is the part that decides how much work a tick may do: the drain budget, the
 * latch's behaviour when a tick *fails*, and the rule that a half-open probe
 * executes **exactly one** purge for the whole tick rather than one per iteration.
 *
 * `purge-plan.spec.ts` proves the decision function. **A pure function nobody
 * called is not a control**, and `PURGE_DRAIN_BUDGET` is a number an operator
 * tunes against a backlog: a sweeper that ignored it would look identical in every
 * other test and would drain its whole queue in one tick exactly like the legacy's
 * `while (true)` loop. So this file asserts the wiring: that `budget - executed`
 * reaches the decision, and that the loop actually stops.
 */

const CLAIM = 'authz.claim_due_purge';
const COMPLETE = 'authz.complete_purge';

/** A drain budget of three purges, and an interval long enough not to matter. */
function breakerEnv(budget: number): BreakerEnvironment {
  return { ...TRIP_ENV, purgeDrainBudget: budget };
}

function claimRow(index: number): Record<string, unknown> {
  return {
    id: `00000000-0000-0000-0000-0000000000${String(index).padStart(3, '0')}`,
    target_kind: 'user',
    target_id: `00000000-0000-0000-0000-0000000001${String(index).padStart(3, '0')}`,
    target_ref: null,
    reason: 'inactivity_purge',
    attempt: 1,
  };
}

/**
 * A queue with `available` due rows and then nothing.
 *
 * The trailing `{ rows: [], rowCount: 0 }` is the shape an exhausted queue
 * returns, and it is what makes the difference between "the budget stopped the
 * drain" and "the queue ran out" observable: the budget case must stop **with
 * rows still available**, so a reader can see the budget and not the emptiness
 * doing the work.
 */
function queueWith(available: number): ScriptedPool {
  return scriptedPool([
    {
      when: (statement) => statement.includes(CLAIM),
      results: [
        ...Array.from({ length: available }, (_unused, index) => ({ rows: [claimRow(index + 1)], rowCount: 1 })),
        { rows: [], rowCount: 0 },
      ],
    },
    // Every settle write matches the one row this instance owns, which is the only
    // answer that lets a purge be reported as completed.
    { when: (statement) => statement.includes(COMPLETE), results: [{ rows: [{ complete_purge: 1 }], rowCount: 1 }] },
  ]);
}

/** Records every claim it is asked to execute, so "how many purges ran" is a fact. */
function countingExecutor(rowsPerPurge = 1): { readonly executor: PurgeExecutor; readonly executed: () => readonly PurgeClaim[] } {
  const executed: PurgeClaim[] = [];
  return {
    executor: {
      execute(_client: unknown, claim: PurgeClaim): Promise<number> {
        executed.push(claim);
        return Promise.resolve(rowsPerPurge);
      },
    },
    executed: () => executed,
  };
}

async function armed(env: BreakerEnvironment, pool: ScriptedPool, executor: PurgeExecutor, percent = 10): Promise<{
  readonly harness: TripHarness;
  readonly sweeper: PurgeSweeper;
}> {
  const harness = tripHarness(env);
  await harness.meterAt(percent).tick(T0);
  return { harness, sweeper: new PurgeSweeper(env, harness.gate, pool.source, executor, harness.jobs) };
}

function countOf(statements: readonly string[], fragment: string): number {
  return statements.filter((statement) => statement.includes(fragment)).length;
}

describe('the drain budget bounds the work one tick may do', () => {
  it('stops after exactly PURGE_DRAIN_BUDGET purges even though the queue still has work', async () => {
    // The legacy drained with `@Cron` around `while (true)`: one tick ran until
    // the queue emptied, the interval fired mid-drain, and two ticks raced for the
    // same rows. The work left over is still queued at the next tick — nothing is
    // lost and nothing is claimed twice — so bounding the tick is free.
    const pool = queueWith(10);
    const { executor, executed } = countingExecutor();
    const { sweeper } = await armed(breakerEnv(3), pool, executor);

    const summary = await sweeper.sweep(T0);

    expect(summary).toEqual({ executed: 3, rowsDeleted: 3, failed: 0, lastOutcome: 'budget_exhausted' });
    expect(executed()).toHaveLength(3);
    // And the rows were still there: the budget stopped the tick, not the queue.
    expect(countOf(pool.statements().map((s) => s.text), CLAIM)).toBe(3);
    expect(pool.connects()).toBe(3);
  });

  it('yields to the next tick rather than looping, so the leftover work is claimed later and not lost', async () => {
    const pool = queueWith(10);
    const { executor, executed } = countingExecutor();
    const { sweeper } = await armed(breakerEnv(2), pool, executor);

    const first = await sweeper.sweep(T0);
    expect(first.executed).toBe(2);

    // The next tick takes its own budget from the full allowance, not from
    // whatever the previous tick had left: `budgetRemaining` is computed from
    // `budget - executed` per TICK, so nothing carries over and nothing compounds.
    const second = await sweeper.sweep(T0 + 1);
    expect(second.executed).toBe(2);
    expect(second.lastOutcome).toBe('budget_exhausted');
    expect(executed()).toHaveLength(4);
  });

  it('reports nothing due rather than a budget failure when the queue really is empty', async () => {
    // The two are different facts and an operator tuning against a backlog needs
    // them apart: `budget_exhausted` means work was left, `nothing_due` means
    // there was none.
    const pool = queueWith(0);
    const { executor, executed } = countingExecutor();
    const { sweeper } = await armed(breakerEnv(5), pool, executor);

    await expect(sweeper.sweep(T0)).resolves.toEqual({ executed: 0, rowsDeleted: 0, failed: 0, lastOutcome: 'nothing_due' });
    expect(executed()).toEqual([]);
  });

  it('runs one purge at a budget of one, so a budget of one is honoured rather than treated as unlimited', async () => {
    // `budgetRemaining <= 0` is the only stopping condition, so a budget of 1 must
    // stop after one — the boundary a `while (executed--)` off-by-one would miss.
    const pool = queueWith(3);
    const { executor, executed } = countingExecutor();
    const { sweeper } = await armed(breakerEnv(1), pool, executor);

    const summary = await sweeper.sweep(T0);

    expect(summary.executed).toBe(1);
    expect(summary.lastOutcome).toBe('budget_exhausted');
    expect(executed()).toHaveLength(1);
  });
});

describe('the latch survives a failure', () => {
  it('releases it when a tick throws, because a latch cleared only on success is a sweeper that stopped', async () => {
    const boom = new Error('the claim failed');
    const pool = scriptedPool([{ when: (statement) => statement.includes(CLAIM), results: [{ rows: [], rowCount: 0 }] }], {
      raise: { when: (statement) => statement.includes(CLAIM), error: boom },
    });
    const { executor } = countingExecutor();
    const { sweeper } = await armed(breakerEnv(3), pool, executor);

    await expect(sweeper.tick(T0)).rejects.toThrow(boom);

    // The second tick was not skipped by a stuck latch: it reached the gate and
    // the database and failed there too, which is the only way to tell the two
    // apart — the skip summary is indistinguishable from a real empty drain.
    const second = sweeper.tick(T0 + 1);
    await expect(second).rejects.toThrow(boom);
    expect(pool.connects()).toBe(2);
  });
});

describe('the half-open probe allowance is one purge for the WHOLE tick', () => {
  it('executes exactly one purge after the cooldown and then returns, so a probe cannot recreate the pressure', async () => {
    const harness = tripHarness(breakerEnv(5));
    await harness.meterAt(99).tick(T0);
    expect(harness.registry.get().mode).toBe('open');

    const pool = queueWith(10);
    const { executor, executed } = countingExecutor();
    const sweeper = new PurgeSweeper(breakerEnv(5), harness.gate, pool.source, executor, harness.jobs);

    // Nothing is admitted while the breaker is open, budget or no budget.
    await expect(sweeper.sweep(T0)).resolves.toMatchObject({ executed: 0, lastOutcome: 'gated' });

    // Settled: past the cooldown AND below yellow.
    await harness.meterAt(20).tick(T0 + 200_000);
    expect(harness.registry.get().mode).toBe('half_open');

    const summary = await sweeper.sweep(T0 + 200_000);

    // FIVE purges were permitted by the budget. One ran. That is the assertion:
    // a probe allowance applied per ITERATION rather than per TICK would run all
    // five and recreate exactly the pressure that opened the breaker.
    expect(summary.executed).toBe(1);
    expect(executed()).toHaveLength(1);
    expect(pool.connects()).toBe(1);
  });

  it('closes the breaker when that one purge succeeds, and re-opens it when the purge fails', async () => {
    const harness = tripHarness(breakerEnv(5));
    await harness.meterAt(99).tick(T0);
    await harness.meterAt(20).tick(T0 + 200_000);

    const failing = new Error('the delete failed');
    const pool = scriptedPool([
      { when: (statement) => statement.includes(CLAIM), results: [{ rows: [claimRow(1)], rowCount: 1 }] },
      { when: (statement) => statement.includes(COMPLETE), results: [{ rows: [{ complete_purge: 1 }], rowCount: 1 }] },
      { when: (statement) => statement.includes('requeue_purge'), results: [{ rows: [{ requeue_purge: 1 }], rowCount: 1 }] },
    ]);
    const executor: PurgeExecutor = {
      execute(): Promise<number> {
        return Promise.reject(failing);
      },
    };
    const sweeper = new PurgeSweeper(breakerEnv(5), harness.gate, pool.source, executor, harness.jobs);

    const summary = await sweeper.sweep(T0 + 200_000);

    expect(summary).toEqual({ executed: 1, rowsDeleted: 0, failed: 1, lastOutcome: 'attempt' });
    // A failed probe is a probe that reported failure.
    expect(harness.registry.get().mode).toBe('open');
  });
});

describe('GATE is consulted per purge, so a mid-drain trip stops the drain', () => {
  it('stops after the purge that was already under way and does not claim another row', async () => {
    // A gate consulted once per TICK can be closed a microsecond after that
    // consultation, and the rest of the batch runs anyway — a gate that gates
    // nothing after the first call. So the decision is asked again per purge, and
    // the trip is a mid-sweep one: it happens while the FIRST purge's transaction
    // is still open.
    const harness = tripHarness(breakerEnv(10));
    await harness.meterAt(10).tick(T0);

    const held = gate();
    let reached: () => void = () => undefined;
    const claimed = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const pool = scriptedPool(
      [
        { when: (statement) => statement.includes(CLAIM), results: [{ rows: [claimRow(1)], rowCount: 1 }, { rows: [claimRow(2)], rowCount: 1 }] },
        { when: (statement) => statement.includes(COMPLETE), results: [{ rows: [{ complete_purge: 1 }], rowCount: 1 }] },
      ],
      {
        block: { when: (statement) => statement.includes(COMPLETE), until: held.open },
        onStatement: (statement) => {
          if (statement.includes(COMPLETE)) {
            reached();
          }
        },
      },
    );
    const { executor, executed } = countingExecutor();
    const sweeper = new PurgeSweeper(breakerEnv(10), harness.gate, pool.source, executor, harness.jobs);

    const sweep = sweeper.sweep(T0);
    await claimed;

    // The meter trips while the first purge is mid-transaction.
    await harness.meterAt(99).tick(T0 + 1);
    expect(harness.registry.get().mode).toBe('open');

    held.release();
    const summary = await sweep;

    expect(summary.executed).toBe(1);
    expect(summary.lastOutcome).toBe('gated');
    // One claim, one completion, one purge. The second row was never claimed, so
    // no second instance can have been handed it and the queue still owns it.
    expect(executed()).toHaveLength(1);
    expect(countOf(pool.statements().map((s) => s.text), CLAIM)).toBe(1);
  });
});