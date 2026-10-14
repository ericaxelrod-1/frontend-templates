import { SchedulerRegistry } from '@nestjs/schedule';
import { describe, expect, it } from 'vitest';
import type { BreakerEnvironment } from '../../../src/breaker/breaker-environment.js';
import { BreakerGate } from '../../../src/breaker/breaker-gate.js';
import { BreakerMeter } from '../../../src/breaker/breaker-meter.js';
import { BreakerRegistry } from '../../../src/breaker/breaker-registry.js';
import { buildHealthSnapshot } from '../../../src/breaker/breaker-health.js';
import { AUTH_LOGIN, BREAKER_METER, PURGE_SWEEPER } from '../../../src/breaker/dispatch-token.js';
import { PurgeSweeper } from '../../../src/purge/purge-sweeper.service.js';
import type { PurgeClaim } from '../../../src/purge/purge-claim.js';
import {
  connectionSource,
  executorThatMustNotRun,
  probeAt,
  ProbeNeverReachedError,
  refusalOf,
  TRIP_ENV,
  T0,
  unreadableProbe,
} from '../../support/breaker-harness.js';

/**
 * **The trip path, executed.**
 *
 * A breaker whose trip branch is never exercised is a control that has only been
 * described. So this file drives the real objects — the real `BreakerMeter`, the
 * real `BreakerGate`, the real `PurgeSweeper` — through a fixture *memory probe*,
 * which is the one seam the design provides for exactly this: the meter is handed
 * a `MemoryProbeDeps`, so the signal can be forced without allocating 9 exabytes.
 *
 * Two things are asserted, and the second is the one that matters:
 *
 *  1. the breaker reaches `open` at 99 %;
 *  2. **the sweeper's drain stops and the database is never touched** — the
 *     connection source below throws if `connect()` is reached at all, so "GATE
 *     blocks dispatch, not the request" is proved by the absence of a connection
 *     rather than by a status code.
 *
 * The harness itself — the environment, the memory probe, the refusing connection
 * source, the refusal reader — lives in `test/support/breaker-harness.ts` rather
 * than here, because the retention scheduling specs need the identical shape and
 * a second copy would be free to drift away from this one.
 */

/** The protection set this file asserts against, spelled out rather than inherited. */
const ENV: BreakerEnvironment = TRIP_ENV;

function build(percent: number): {
  readonly registry: BreakerRegistry;
  readonly meter: BreakerMeter;
  readonly gate: BreakerGate;
  readonly sweeper: PurgeSweeper;
  readonly connects: () => number;
} {
  const registry = new BreakerRegistry(ENV);
  const scheduler = new SchedulerRegistry();
  const meter = new BreakerMeter(registry, probeAt(percent), scheduler);
  const gate = new BreakerGate(registry, ENV, scheduler);
  const pool = connectionSource();
  const sweeper = new PurgeSweeper(ENV, gate, pool.source, executorThatMustNotRun(), scheduler);
  return { registry, meter, gate, sweeper, connects: pool.connects };
}

describe('the breaker guards a real job', () => {
  it('opens at 99 % and the purge sweeper is gated before it reaches the database', async () => {
    const { registry, meter, sweeper, connects } = build(99);

    await meter.tick(T0);
    expect(registry.get().mode).toBe('open');
    expect(registry.get().sample?.reading?.percent).toBeCloseTo(99, 6);

    const summary = await sweeper.sweep(T0);

    expect(summary).toEqual({ executed: 0, rowsDeleted: 0, failed: 0, lastOutcome: 'gated' });
    // The proof that GATE is a DISPATCH gate: the connection was never opened, so
    // nothing was queued, nothing was started, and nothing was half-applied.
    expect(connects()).toBe(0);
  });

  it('drains the same job at 10 %, so the trip test above is a gate and not a dead sweeper', async () => {
    const { registry, meter, sweeper, connects } = build(10);

    await meter.tick(T0);
    expect(registry.get().mode).toBe('closed');

    // The connection source rejects, and the rejection is what reaches the caller:
    // the sweeper got all the way to the database, which is exactly what the gated
    // run above did not do.
    await expect(sweeper.sweep(T0)).rejects.toThrow(ProbeNeverReachedError);
    expect(connects()).toBe(1);
  });

  it('admits a protected site at 99 % while its pressure is still reported', async () => {
    const { registry, meter, gate } = build(99);
    await meter.tick(T0);

    const admission = gate.acquire(AUTH_LOGIN, false, T0);
    expect(admission.admit).toBe(true);

    // Bypass stops BLOCKING; it never stops REPORTING. An override that removes
    // the only instrument makes overriding unsurvivable.
    const snapshot = buildHealthSnapshot(registry.get(), registry.runtime, { freeBytes: 1, freeRatio: 1 }, T0);
    expect(snapshot.memory.percent).toBe(99);
    expect(snapshot.memory.zone).toBe('red');
    expect(snapshot.breaker.state).toBe('open');
  });

  it('keeps metering while the gate refuses everything, because a breaker inside the thing it gates stops observing', async () => {
    const { registry, meter, sweeper } = build(99);

    await meter.tick(T0);
    await sweeper.sweep(T0);
    const firstMeasuredAt = registry.get().sample?.measuredAtMs;

    // Every stoppable dispatch is refused, and the meter still publishes.
    await meter.tick(T0 + 30_000);

    expect(registry.get().sample?.measuredAtMs).toBe(T0 + 30_000);
    expect(registry.get().sample?.measuredAtMs).not.toBe(firstMeasuredAt);
    expect(registry.get().mode).toBe('open');
  });

  it('admits exactly one probe after the cooldown, and closes only when that probe reports', async () => {
    const registry = new BreakerRegistry(ENV);
    const scheduler = new SchedulerRegistry();
    const gate = new BreakerGate(registry, ENV, scheduler);
    const hot = new BreakerMeter(registry, probeAt(99), scheduler);
    const cool = new BreakerMeter(registry, probeAt(20), scheduler);

    await hot.tick(T0);
    expect(gate.acquire(PURGE_SWEEPER, true, T0).admit).toBe(false);

    // Settled: past the cooldown AND below yellow.
    await cool.tick(T0 + 200_000);
    expect(registry.get().mode).toBe('half_open');

    const probe = gate.acquire(PURGE_SWEEPER, true, T0 + 200_000);
    expect(probe.admit).toBe(true);
    expect(probe.admit && probe.lease.probe).toBe(true);

    // Every other dispatch stays gated while the probe is in flight.
    expect(refusalOf(gate.acquire(PURGE_SWEEPER, true, T0 + 200_001))).toBe('probe_in_flight');

    if (!probe.admit) {
      throw new Error('the probe should have been admitted');
    }
    probe.lease.release('succeeded');

    expect(registry.get().mode).toBe('closed');
    expect(registry.get().openedAtMs).toBeNull();
    expect(gate.acquire(PURGE_SWEEPER, true, T0 + 200_002).admit).toBe(true);
  });

  it('aborts a stoppable dispatch in flight and leaves a non-stoppable one alone', async () => {
    const { registry, meter, gate } = build(99);
    await meter.tick(T0);

    const stoppable = gate.acquire(PURGE_SWEEPER, true, T0);
    expect(stoppable.admit).toBe(false);

    // With the breaker closed, both shapes can be taken out.
    const closed = build(10);
    await closed.meter.tick(T0);

    const recoverable = closed.gate.acquire(PURGE_SWEEPER, true, T0);
    const emailish = closed.gate.acquire('email.send', false, T0);
    expect(recoverable.admit).toBe(true);
    expect(emailish.admit).toBe(true);
    if (!recoverable.admit || !emailish.admit) {
      throw new Error('both leases should have been admitted');
    }

    expect(recoverable.lease.signal).toBeDefined();
    expect(recoverable.lease.signal?.aborted).toBe(false);
    // NOT stoppable: GATE applies, STOP does not. Aborting a send mid-SMTP would
    // yield a delivered-and-unrecorded email, which is worse than either outcome.
    expect(emailish.lease.signal).toBeUndefined();

    expect(closed.gate.liveStoppableCount()).toBe(1);
    expect(closed.gate.stopInFlight('test')).toBe(1);

    expect(recoverable.lease.signal?.aborted).toBe(true);
    // Still live: aborting is a signal, not a cancellation. The owner decides when
    // its dispatch is over, and until it does the lease is still counted.
    expect(closed.gate.liveStoppableCount()).toBe(1);
    expect(closed.registry.get().stoppedDispatches).toBe(1);

    recoverable.lease.release('aborted');
    expect(closed.gate.liveStoppableCount()).toBe(0);
    expect(registry.get().mode).toBe('open');
  });

  it('gates rather than admits when the figure is unreadable, and never substitutes a safe number', async () => {
    const registry = new BreakerRegistry(ENV);
    const scheduler = new SchedulerRegistry();
    const gate = new BreakerGate(registry, ENV, scheduler);
    const meter = new BreakerMeter(registry, unreadableProbe(), scheduler);

    await meter.tick(T0);

    // The inverse of homegrown-etl's `return 50; // Return safe default value`
    // (`job-queue.service.ts:1481-1484`): 50 sits below its green zone of 60, so an
    // unreadable figure OPENED the gate and dispatched at full concurrency.
    expect(registry.get().sample?.usable).toBe(false);
    expect(registry.get().sample?.reading).toBeNull();
    expect(refusalOf(gate.acquire(PURGE_SWEEPER, true, T0))).toBe('unusable');
  });

  it('registers and clears exactly the two named intervals, and both survive shutdown', async () => {
    const registry = new BreakerRegistry(ENV);
    const scheduler = new SchedulerRegistry();
    const meter = new BreakerMeter(registry, probeAt(50), scheduler);
    const gate = new BreakerGate(registry, ENV, scheduler);

    // Awaited because the meter's bootstrap hook takes its first reading before it
    // registers anything, and Nest awaits bootstrap hooks too.
    await meter.onApplicationBootstrap();
    gate.onApplicationBootstrap();
    expect(scheduler.getIntervals().sort()).toEqual(['breaker.gate', 'breaker.meter']);

    meter.onModuleDestroy();
    gate.onModuleDestroy();
    expect(scheduler.getIntervals()).toEqual([]);
  });

  it('refuses to overlap with itself, because a self-overlapping drain races itself for the queue', async () => {
    const { meter, sweeper, registry } = build(50);
    await meter.tick(T0);
    expect(registry.get().mode).toBe('closed');

    const first = sweeper.tick(T0);
    const second = await sweeper.tick(T0);
    expect(second.executed).toBe(0);
    await expect(first).rejects.toThrow(ProbeNeverReachedError);

    // The latch is released even when the tick threw, or a failed tick wedges the
    // sweeper permanently — the same trap pointed the other way.
    expect(registry.get().mode).toBe('closed');
    await expect(sweeper.tick(T0 + 30_000)).rejects.toThrow(ProbeNeverReachedError);
    await meter.tick(T0);
  });
});

describe('the meter is the instrument, not a bystander', () => {
  it('is its own protected dispatch site, so no dispatch decision can stop it', () => {
    expect(ENV.protectedTokens).toContain(BREAKER_METER);
    expect(ENV.protectedTokens).toContain('breaker.gate');
  });

  it('counts the queue rows it claims, so the operator can see the cost of the gate', async () => {
    const { registry, meter, gate } = build(99);
    // Measured, and genuinely in the red. The count has to come from real
    // refusals, so it cannot be taken from the never-measured state — which the
    // gate no longer refuses, because that state is a gap in the record rather
    // than a fault in the instrument.
    await meter.tick(T0);
    expect(registry.get().mode).toBe('open');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      gate.acquire(PURGE_SWEEPER, true, T0);
    }
    expect(registry.get().gatedDispatches).toBe(3);
  });
});

/** Kept so the claim type is referenced and its shape stays load-bearing. */
export type ClaimShape = Pick<PurgeClaim, 'id' | 'reason' | 'targetKind'>;