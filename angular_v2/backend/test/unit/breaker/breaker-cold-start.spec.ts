import { SchedulerRegistry } from '@nestjs/schedule';
import { describe, expect, it, vi } from 'vitest';
import { loadBreakerEnvironment } from '../../../src/breaker/breaker-environment.js';
import type { BreakerEnvironment } from '../../../src/breaker/breaker-environment.js';
import { BreakerMeter } from '../../../src/breaker/breaker-meter.js';
import { BreakerRegistry } from '../../../src/breaker/breaker-registry.js';
import type { BreakerRuntime, BreakerState, MemorySample } from '../../../src/breaker/breaker-state.js';
import {
  decideDispatch,
  initialBreakerState,
  isStale,
  stalenessWindowMs,
} from '../../../src/breaker/breaker-state.js';
import { PURGE_SWEEPER } from '../../../src/breaker/dispatch-token.js';
import { CGROUP_V2_LIMIT_FILE, CGROUP_V2_USAGE_FILE } from '../../../src/breaker/memory-reading.js';
import type { MemoryProbeDeps } from '../../../src/breaker/memory-reading.js';

/**
 * **The cold-start window, and the pair that closes it.**
 *
 * `BREAKER_POLL_SECONDS` defaults to 30. The meter's first publication used to be
 * one whole interval away, and `initialBreakerState()` answered `stale: true`
 * with `sample: null`, so `decideDispatch` refused every non-protected dispatch
 * with `202` between process start and the first tick. A process alive for 300 ms
 * had not failed to measure anything; it had not measured yet.
 *
 * This is not a hypothetical. It is what turned the committed, previously-green
 * `test/e2e/email.e2e-spec.ts` red: `EmailProbeController` serves
 * `POST /auth/email/verification` and `POST /auth/email/password-reset`, neither of
 * which is a route in `src/auth/auth.controller.ts`, so `dispatchTokenForRoute`
 * returns `undefined`, the site is unprotected, and the gate refused it before the
 * handler ran. The suite saw `202` where it expected `200`.
 *
 * ## Why the fix needs BOTH halves, and why one assertion is not enough
 *
 * The two cases below are one site, one runtime, one staleness window apart, and
 * the difference between them is the whole fix:
 *
 *   - **no sample yet** → admitted. Nothing has been measured, so nothing has
 *     gone stale, and an instrument that has not spoken has not failed.
 *   - **a stale sample** → refused. The instrument spoke and then stopped, and an
 *     instrument that has lost the resource cannot claim the resource is fine.
 *
 * Dropping either is a regression in the opposite direction: admit the stale
 * sample and the breaker latches open at full concurrency while the health surface
 * cheerfully reports the last known percent; refuse the never-measured state and
 * every process refuses its own traffic for 30 s after boot. A suite that only
 * asserted the first half would have passed against the old code the moment the
 * `stale` flag was cleared — which is the mistake that let this ship in the first
 * place. **Every unit test in `breaker-state.spec.ts` injected a reading before
 * asking the gate anything, so none of them ever saw the pre-measurement state.**
 *
 * The second half of the fix — the meter's eager first reading — is proved here
 * too, because without it the state machine alone would be admitting a state the
 * application should never reach: a meter that can never publish would be
 * indistinguishable from a meter that has not published yet, and would admit
 * forever with nothing reporting why.
 */

const ENV: BreakerEnvironment = loadBreakerEnvironment({
  BREAKER_MEMORY_GREEN: '60',
  BREAKER_MEMORY_YELLOW: '80',
  BREAKER_MEMORY_RED: '90',
  BREAKER_POLL_SECONDS: '30',
  BREAKER_COOLDOWN_SECONDS: '120',
  BREAKER_PROBE_TIMEOUT_SECONDS: '60',
  BREAKER_PROTECTED: 'auth.login,auth.refresh,auth.logout,auth.me,breaker.meter,breaker.gate',
});

const RUNTIME: BreakerRuntime = {
  thresholds: ENV.thresholds,
  pollSeconds: ENV.pollSeconds,
  cooldownSeconds: ENV.cooldownSeconds,
  probeTimeoutSeconds: ENV.probeTimeoutSeconds,
  protectedTokens: ENV.protectedTokens,
};

const T0 = 1_700_000_000_000;
const MIB = 1024 * 1024;
const LIMIT_BYTES = 256 * MIB;

/** A 256 MB cgroup v2 container reporting `percent` used. */
function probeAt(percent: number): MemoryProbeDeps {
  const used = Math.round((LIMIT_BYTES * percent) / 100);
  return {
    readTextFile: (path) =>
      path === CGROUP_V2_LIMIT_FILE ? String(LIMIT_BYTES) : path === CGROUP_V2_USAGE_FILE ? String(used) : undefined,
    totalMemBytes: () => LIMIT_BYTES,
    freeMemBytes: () => LIMIT_BYTES - used,
  };
}

/** The state a settled, healthy reading puts the registry in. */
function healthySampleAt(measuredAtMs: number): MemorySample {
  return {
    measuredAtMs,
    usable: true,
    reading: { usedBytes: Math.round(LIMIT_BYTES / 10), limitBytes: LIMIT_BYTES, percent: 10, source: 'cgroup_v2' },
  };
}

/**
 * Nest's `ConsoleLogger` writes to `process.stdout`, so this is where the meter's
 * one-line-per-tick health surface actually goes. Observed, not stubbed: nothing
 * is replaced and nothing is faked, the process is just watched writing.
 */
function captureStdout(): { readonly lines: () => string[]; readonly restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown): boolean => {
    lines.push(String(chunk));
    return true;
  });
  return { lines: () => lines, restore: () => spy.mockRestore() };
}

describe('the two readings that are not the same reading', () => {
  /**
   * The pair, on one site and one runtime. Everything else is held constant, so
   * if this ever goes red the only thing that can have changed is the distinction
   * it exists to pin.
   */
  it('admits a named, unprotected site with no sample yet, and refuses the same site on a stale one', () => {
    // Left of the pair: the process has not measured. `PURGE_SWEEPER` is named,
    // so the gate can see exactly what it is refusing, and it is deliberately
    // absent from `BREAKER_PROTECTED`.
    expect(ENV.protectedTokens).not.toContain(PURGE_SWEEPER);

    const neverMeasured = initialBreakerState();
    const admitted = decideDispatch(neverMeasured, PURGE_SWEEPER, RUNTIME, T0);
    expect(admitted.admit).toBe(true);
    expect(admitted.refusal).toBeNull();
    // An admission is not a refusal and is not counted as one.
    expect(admitted.state.gatedDispatches).toBe(0);

    // Right of the pair: the meter spoke, and then stopped. Same site, same
    // runtime, one staleness window later.
    const settled: BreakerState = { ...neverMeasured, sample: healthySampleAt(T0) };
    const windowMs = stalenessWindowMs(RUNTIME.pollSeconds);
    expect(decideDispatch(settled, PURGE_SWEEPER, RUNTIME, T0 + windowMs).admit).toBe(true);

    const staleRefused = decideDispatch(settled, PURGE_SWEEPER, RUNTIME, T0 + windowMs + 1);
    expect(staleRefused.admit).toBe(false);
    expect(staleRefused.refusal).toBe('stale');
    expect(staleRefused.state.gatedDispatches).toBe(1);
  });

  it('does not read an absent sample as a stale one, however far the clock has moved', () => {
    // The clock is the point. An implementation that compared `nowMs` against a
    // null `measuredAtMs` — or that kept `sample === null` inside the staleness
    // test — reports a dead instrument for a process that has only just started.
    expect(isStale(null, T0, RUNTIME.pollSeconds)).toBe(false);
    expect(isStale(null, T0 + 3_600_000, RUNTIME.pollSeconds)).toBe(false);
    expect(initialBreakerState().stale).toBe(false);
  });

  it('refuses a never-measured state that nevertheless claims to be open, rather than admitting on an assumption', () => {
    // Unreachable by construction — every transition that opens the breaker
    // carries a sample — and asserted anyway, so the invariant is enforced rather
    // than left in a comment.
    const openWithoutASample: BreakerState = { ...initialBreakerState(), mode: 'open', openedAtMs: T0 };

    const decision = decideDispatch(openWithoutASample, PURGE_SWEEPER, RUNTIME, T0);
    expect(decision.admit).toBe(false);
    expect(decision.refusal).toBe('open');
  });
});

describe('the meter publishes its first reading during bootstrap', () => {
  it('has a sample before the interval exists, so nothing is served from an unmeasured state', async () => {
    const registry = new BreakerRegistry(ENV);
    const scheduler = new SchedulerRegistry();
    const meter = new BreakerMeter(registry, probeAt(10), scheduler);

    // Before: nothing has been measured.
    expect(registry.get().sample).toBeNull();

    await meter.onApplicationBootstrap();

    // After: measured once, before a listener could exist. This is the assertion
    // that stands between the committed e2e suite and a `202`.
    expect(registry.get().sample).not.toBeNull();
    expect(registry.get().sample?.usable).toBe(true);
    expect(registry.get().mode).toBe('closed');
    expect(scheduler.getIntervals()).toContain('breaker.meter');

    meter.onModuleDestroy();
  });

  it('publishes that first reading through tick(), so boot and every later tick are one mechanism', async () => {
    // Two publication paths would drift (§2.4), and the one that runs only at
    // boot is the one nobody re-tests. `tick()` is the only thing that emits the
    // snapshot line, so seeing the line at boot IS the evidence that the boot
    // reading went through the same code as the 400th.
    const registry = new BreakerRegistry(ENV);
    const meter = new BreakerMeter(registry, probeAt(42), new SchedulerRegistry());
    const stdout = captureStdout();

    try {
      await meter.onApplicationBootstrap();
    } finally {
      stdout.restore();
      meter.onModuleDestroy();
    }

    expect(registry.get().sample?.reading?.percent).toBeCloseTo(42, 6);
    const snapshot = stdout.lines().find((line) => line.includes('breaker snapshot'));
    expect(snapshot).toBeDefined();
    expect(snapshot).toContain('percent=42');
  });

  it('fails closed rather than open when the eager reading cannot produce a figure', async () => {
    // The other half of why the eager sample exists. "Not measured yet" and
    // "measured and unreadable" are different states, and only the second one may
    // gate: a probe that can never publish is an instrument that has lost the
    // resource, and `usable: false` is what says so. A meter that published
    // `null` instead would be the cold-start hole reopened from the other side.
    const registry = new BreakerRegistry(ENV);
    const meter = new BreakerMeter(
      registry,
      { readTextFile: () => undefined, totalMemBytes: () => 0, freeMemBytes: () => 0 },
      new SchedulerRegistry(),
    );

    await meter.onApplicationBootstrap();

    expect(registry.get().sample).not.toBeNull();
    expect(registry.get().sample?.usable).toBe(false);
    expect(registry.get().mode).toBe('open');

    const decision = decideDispatch(registry.get(), PURGE_SWEEPER, RUNTIME, T0);
    expect(decision.admit).toBe(false);
    expect(decision.refusal).toBe('unusable');

    meter.onModuleDestroy();
  });
});