import { describe, expect, it } from 'vitest';
import { buildHealthSnapshot } from '../../../src/breaker/breaker-health.js';
import type { BreakerHealthSnapshot } from '../../../src/breaker/breaker-health.js';
import { applySample, initialBreakerState, recheck } from '../../../src/breaker/breaker-state.js';
import type { BreakerRuntime, BreakerState, MemorySample } from '../../../src/breaker/breaker-state.js';
import { AUTH_LOGIN, BREAKER_METER } from '../../../src/breaker/dispatch-token.js';

/**
 * The health surface is **counts against named thresholds**, and the load-bearing
 * assertion in this file is the one that is NOT a count: **there is no aggregate
 * `status` field**.
 *
 * That absence is rebase.md §9B.3's whole argument made mechanical. The legacy
 * collapsed one scalar — the DISK percentage, which its own dispatcher never
 * consulted — onto `NORMAL | WARNING | CRITICAL | PANIC`
 * (`system-health.service.ts:119`, `:158-172`), which is why a completely
 * saturated process reported `NORMAL`. There is no correct function from N
 * independent booleans to a three-state enum, because "refuse everything that
 * allocates" and "refuse nothing" are different verdicts about different resources
 * and the enum forces one of them to lie.
 *
 * Asserted on the KEY SET by name, so putting `status` back is a red test rather
 * than a code-review opinion.
 */

const RUNTIME: BreakerRuntime = {
  thresholds: { green: 60, yellow: 80, red: 90 },
  pollSeconds: 30,
  cooldownSeconds: 120,
  probeTimeoutSeconds: 60,
  protectedTokens: [AUTH_LOGIN, BREAKER_METER],
};

const T0 = 1_700_000_000_000;

/**
 * `atMs` exists so a sample can be measured at an instant other than `T0` — the
 * clock is a value here, never a sleep, so `since_seconds` and staleness are
 * exercised at chosen instants instead of waited for.
 */
function sample(percent: number, atMs: number = T0): MemorySample {
  return {
    measuredAtMs: atMs,
    usable: true,
    reading: { usedBytes: percent * 10, limitBytes: 1000, percent, source: 'cgroup_v2' },
  };
}

function snapshotOf(state: BreakerState, nowMs = T0): BreakerHealthSnapshot {
  return buildHealthSnapshot(state, RUNTIME, { freeBytes: 1024, freeRatio: 12.5 }, nowMs);
}

describe('the health surface', () => {
  it('has no aggregate status field, at the top level or anywhere inside it', () => {
    const snapshot = snapshotOf(applySample(initialBreakerState(), sample(99), RUNTIME, T0));

    const forbidden = ['status', 'severity', 'health', 'state', 'overall'];
    const keysOf = (value: unknown, path: string): string[] => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [];
      }
      return Object.entries(value).flatMap(([key, child]) => [
        `${path}.${key}`,
        ...keysOf(child, `${path}.${key}`),
      ]);
    };

    const everyKey = keysOf(snapshot, 'snapshot');
    expect(everyKey).toContain('snapshot.memory.zone');
    expect(everyKey).toContain('snapshot.breaker.state');
    // The breaker's own state IS reported — it is the state machine's own name, not
    // an aggregate verdict over several signals. What must not exist is a SINGLE
    // field summarising the whole surface.
    expect(everyKey.filter((key) => key === 'snapshot.status' || key === 'snapshot.breaker.status')).toEqual([]);
    expect(snapshot).not.toHaveProperty('status');
    expect(forbidden.filter((key) => Object.hasOwn(snapshot, key) && key !== 'state')).toEqual([]);
  });

  it('names every signal and the threshold each is counted against', () => {
    const snapshot = snapshotOf(applySample(initialBreakerState(), sample(99), RUNTIME, T0));

    expect(Object.keys(snapshot).sort()).toEqual(['breaker', 'disk', 'memory']);
    expect(Object.keys(snapshot.memory).sort()).toEqual([
      'limit_bytes',
      'measured_at',
      'percent',
      'source',
      'usable',
      'used_bytes',
      'zone',
    ]);
    expect(Object.keys(snapshot.breaker).sort()).toEqual([
      'gated_dispatches',
      'opened_at',
      'probe_in_flight',
      'protected',
      'since_seconds',
      'stale_reading',
      'state',
      'stopped_dispatches',
    ]);
  });

  it('reports memory against its own source, because "90 %" means nothing without it', () => {
    const snapshot = snapshotOf(applySample(initialBreakerState(), sample(95), RUNTIME, T0));

    expect(snapshot.memory).toMatchObject({
      used_bytes: 950,
      limit_bytes: 1000,
      percent: 95,
      source: 'cgroup_v2',
      zone: 'red',
      usable: true,
    });
    expect(snapshot.memory.measured_at).toBe(new Date(T0).toISOString());
  });

  it('reports disk and never lets it decide anything', () => {
    const snapshot = snapshotOf(applySample(initialBreakerState(), sample(5), RUNTIME, T0));

    // Disk exhaustion is not this application's problem: the app cleans up its own
    // logs and temp files, and a disk trip would convert a condition with an
    // obvious manual remedy into an automated refusal that hides it. `bavail`, not
    // `bfree`, because `bfree` counts blocks reserved for root this process may not
    // use.
    expect(snapshot.disk).toEqual({ free_bytes: 1024, free_ratio: 12.5, measured_at: new Date(T0).toISOString() });
    // Nothing in the breaker state moved because the disk figure is what it is.
    expect(snapshot.breaker.state).toBe('closed');
  });

  it('cannot trip on disk, at any free ratio, because the disk figure reaches no decision at all', () => {
    const state = applySample(initialBreakerState(), sample(5), RUNTIME, T0);

    // The strongest available statement: the snapshot's memory and breaker
    // sections are byte-identical at a full disk and at an empty one. Wiring
    // `disk.free_ratio` into a threshold fails here rather than in production,
    // where a full disk would start refusing work it was never the right party to
    // refuse while hiding the condition that `df -h` answers in one second.
    const full = buildHealthSnapshot(state, RUNTIME, { freeBytes: 10 ** 12, freeRatio: 99.9 }, T0);
    const empty = buildHealthSnapshot(state, RUNTIME, { freeBytes: 1, freeRatio: 0.01 }, T0);

    expect(empty.memory).toEqual(full.memory);
    expect(empty.breaker).toEqual(full.breaker);
    expect(empty.breaker.state).toBe('closed');
    // And the disk is still reported, at its own value — reporting is not
    // deciding, and a signal nobody can see is a signal nobody acts on.
    expect(empty.disk.free_ratio).toBe(0.01);
    expect(full.disk.free_ratio).toBe(99.9);
  });

  it('distinguishes a dead instrument from one reporting nothing usable', () => {
    // A meter that STOPPED publishing: no new sample arrives, so the staleness has
    // to be re-derived from the published one.
    const deadMeter = recheck(applySample(initialBreakerState(), sample(5), RUNTIME, T0), RUNTIME, T0 + 120_000);
    const staleSnapshot = snapshotOf(deadMeter, T0 + 120_000);

    expect(staleSnapshot.breaker.stale_reading).toBe(true);
    expect(staleSnapshot.memory.usable).toBe(true);

    const unusable: MemorySample = { measuredAtMs: T0, usable: false, reading: null };
    const unusableSnapshot = snapshotOf(applySample(initialBreakerState(), unusable, RUNTIME, T0));
    expect(unusableSnapshot.breaker.stale_reading).toBe(false);
    expect(unusableSnapshot.memory.usable).toBe(false);
    expect(unusableSnapshot.memory.percent).toBeNull();
    expect(unusableSnapshot.memory.source).toBeNull();
    expect(unusableSnapshot.memory.zone).toBeNull();
  });

  it('reports how long the breaker has been open and which sites are exempt right now', () => {
    const opened = applySample(initialBreakerState(), sample(99, T0 - 90_000), RUNTIME, T0 - 90_000);
    const snapshot = snapshotOf(opened, T0);

    expect(snapshot.breaker.state).toBe('open');
    expect(snapshot.breaker.opened_at).toBe(new Date(T0 - 90_000).toISOString());
    expect(snapshot.breaker.since_seconds).toBe(90);
    // An operator reading "protected" learns WHICH sites cannot be shed — the
    // cost of the exception surface, stated rather than left to be discovered
    // during an incident.
    expect(snapshot.breaker.protected).toEqual([AUTH_LOGIN, BREAKER_METER]);
  });

  it('reports since_seconds as null while closed, rather than 0, which would read as "just closed"', () => {
    const snapshot = snapshotOf(applySample(initialBreakerState(), sample(5), RUNTIME, T0));

    expect(snapshot.breaker.state).toBe('closed');
    expect(snapshot.breaker.since_seconds).toBeNull();
    expect(snapshot.breaker.opened_at).toBeNull();
  });
});