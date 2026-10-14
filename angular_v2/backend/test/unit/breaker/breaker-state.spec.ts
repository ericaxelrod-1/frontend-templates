import { describe, expect, it } from 'vitest';
import { classifyZone, isProbeWorthy } from '../../../src/breaker/breaker-thresholds.js';
import {
  applySample,
  completeProbe,
  decideDispatch,
  expireProbe,
  initialBreakerState,
  isStale,
  recheck,
} from '../../../src/breaker/breaker-state.js';
import type { BreakerRuntime, BreakerState, MemorySample } from '../../../src/breaker/breaker-state.js';
import { AUTH_LOGIN, BREAKER_GATE, BREAKER_METER, PURGE_SWEEPER } from '../../../src/breaker/dispatch-token.js';

/**
 * One trip signal, one machine — rebase.md §9B.7.
 *
 * The clock is a value, not a mock: every function here takes `nowMs`, so
 * cooldown, probe timeout and staleness are exercised at chosen instants rather
 * than by waiting, and a half-open transition is asserted rather than slept for.
 */

const RUNTIME: BreakerRuntime = {
  thresholds: { green: 60, yellow: 80, red: 90 },
  pollSeconds: 30,
  cooldownSeconds: 120,
  probeTimeoutSeconds: 60,
  protectedTokens: [AUTH_LOGIN, BREAKER_METER, BREAKER_GATE],
};

const T0 = 1_700_000_000_000;

function sample(percent: number, atMs: number = T0): MemorySample {
  return {
    measuredAtMs: atMs,
    usable: true,
    reading: { usedBytes: percent, limitBytes: 100, percent, source: 'cgroup_v2' },
  };
}

function closedState(percent: number, atMs: number = T0): BreakerState {
  return applySample(initialBreakerState(), sample(percent, atMs), RUNTIME, atMs);
}

describe('green / yellow / red', () => {
  it('classifies against the three configured bands', () => {
    expect(classifyZone(0, RUNTIME.thresholds)).toBe('green');
    expect(classifyZone(59.9, RUNTIME.thresholds)).toBe('green');
    expect(classifyZone(60, RUNTIME.thresholds)).toBe('yellow');
    expect(classifyZone(89.9, RUNTIME.thresholds)).toBe('yellow');
    expect(classifyZone(90, RUNTIME.thresholds)).toBe('red');
    expect(classifyZone(100, RUNTIME.thresholds)).toBe('red');
  });

  it('reads yellow as the CLEAR threshold, so every configured number decides something', () => {
    // With green 60 / yellow 80 / red 90, the elevated band is [green, red) and
    // `yellow` is where recovery begins. A build where YELLOW is never read would
    // be a config key that exists and does nothing (§2.1).
    expect(isProbeWorthy(79.9, RUNTIME.thresholds, T0, T0 + 120_000, 120)).toBe(true);
    expect(isProbeWorthy(80, RUNTIME.thresholds, T0, T0 + 120_000, 120)).toBe(false);
  });

  it('opens at or above red and closes below green, with hysteresis between them', () => {
    const open = applySample(initialBreakerState(), sample(90), RUNTIME, T0);
    expect(open.mode).toBe('open');
    expect(open.openedAtMs).toBe(T0);

    // A single reading below red does NOT re-admit: the cooldown and the
    // below-yellow condition must both hold, because a momentary dip below red in
    // a rising trend is common and re-probing on it is the flap this refuses.
    const dipped = applySample(open, sample(70, T0 + 30_000), RUNTIME, T0 + 30_000);
    expect(dipped.mode).toBe('open');
    expect(dipped.openedAtMs).toBe(T0);
  });

  it('does not re-stamp opened_at on a sample that is merely still red, or the cooldown never expires', () => {
    const first = applySample(initialBreakerState(), sample(95, T0), RUNTIME, T0);
    const second = applySample(first, sample(97, T0 + 30_000), RUNTIME, T0 + 30_000);

    expect(second.openedAtMs).toBe(T0);
    expect(expireProbe(second, RUNTIME, T0 + 90_000)).toBe(second);
  });
});

describe('half-open recovery', () => {
  it('needs the cooldown AND a reading below yellow before it admits anything', () => {
    const opened = applySample(initialBreakerState(), sample(95, T0), RUNTIME, T0);

    // Time alone: still red, so no.
    expect(applySample(opened, sample(95, T0 + 200_000), RUNTIME, T0 + 200_000).mode).toBe('open');
    // Reading alone: below red but still at/above yellow, so no.
    const justCooled = applySample(opened, sample(85, T0 + 200_000), RUNTIME, T0 + 200_000);
    expect(justCooled.mode).toBe('open');
    // Both: settled.
    expect(applySample(opened, sample(50, T0 + 200_000), RUNTIME, T0 + 200_000).mode).toBe('half_open');
  });

  it('admits exactly one probe, and every other dispatch stays gated while it runs', () => {
    const halfOpen = applySample(
      applySample(initialBreakerState(), sample(95, T0), RUNTIME, T0),
      sample(50, T0 + 200_000),
      RUNTIME,
      T0 + 200_000,
    );

    const probe = decideDispatch(halfOpen, PURGE_SWEEPER, RUNTIME, T0 + 200_000);
    expect(probe.admit).toBe(true);
    expect(probe.probe).toBe(true);

    const second = decideDispatch(probe.state, PURGE_SWEEPER, RUNTIME, T0 + 200_001);
    expect(second.admit).toBe(false);
    expect(second.refusal).toBe('probe_in_flight');
  });

  it('closes on a successful probe, clearing opened_at', () => {
    const halfOpen = applySample(
      applySample(initialBreakerState(), sample(95, T0), RUNTIME, T0),
      sample(50, T0 + 200_000),
      RUNTIME,
      T0 + 200_000,
    );
    const closed = completeProbe(halfOpen, 'succeeded', T0 + 200_100);

    expect(closed.mode).toBe('closed');
    expect(closed.openedAtMs).toBeNull();
    expect(decideDispatch(closed, PURGE_SWEEPER, RUNTIME, T0 + 200_100).admit).toBe(true);
  });

  it('restarts the cooldown from now when the probe fails, rather than re-probing on the old schedule', () => {
    const halfOpen = applySample(
      applySample(initialBreakerState(), sample(95, T0), RUNTIME, T0),
      sample(50, T0 + 200_000),
      RUNTIME,
      T0 + 200_000,
    );
    const reopened = completeProbe(halfOpen, 'failed', T0 + 200_100);

    expect(reopened.mode).toBe('open');
    expect(reopened.openedAtMs).toBe(T0 + 200_100);
    expect(applySample(reopened, sample(50, T0 + 260_000), RUNTIME, T0 + 260_000).mode).toBe('open');
    expect(applySample(reopened, sample(50, T0 + 320_100), RUNTIME, T0 + 320_100).mode).toBe('half_open');
  });

  it('re-opens when a probe never reports, because a half-open breaker whose only admission is the probe would latch forever', () => {
    const halfOpen = applySample(
      applySample(initialBreakerState(), sample(95, T0), RUNTIME, T0),
      sample(50, T0 + 200_000),
      RUNTIME,
      T0 + 200_000,
    );
    const withProbe = decideDispatch(halfOpen, PURGE_SWEEPER, RUNTIME, T0 + 200_000).state;

    expect(expireProbe(withProbe, RUNTIME, T0 + 200_000 + 30_000)).toBe(withProbe);
    const expired = expireProbe(withProbe, RUNTIME, T0 + 200_000 + 61_000);
    expect(expired.mode).toBe('open');
    expect(expired.probeInFlight).toBe(false);
  });
});

describe('an unmeasured reading is never confused with a dead meter', () => {
  it('starts closed and unmeasured, and does not refuse a site for a gap it has not measured', () => {
    const initial = initialBreakerState();
    expect(initial.mode).toBe('closed');
    expect(initial.sample).toBeNull();

    // Nothing has been measured, so nothing can have gone quiet. These are two
    // different faults — an instrument that has died and an instrument that has
    // not spoken yet — and answering `true` for the second refused every
    // non-protected dispatch for the first poll interval of every process's life,
    // on a machine that was under no pressure at all.
    expect(initial.stale).toBe(false);
    expect(isStale(initial.sample, T0 + 3_600_000, RUNTIME.pollSeconds)).toBe(false);

    expect(decideDispatch(initial, PURGE_SWEEPER, RUNTIME, T0).admit).toBe(true);
  });

  it('gates once the meter has not published for 2 × BREAKER_POLL_SECONDS', () => {
    const state = closedState(10, T0);

    expect(isStale(state.sample, T0 + 60_000, RUNTIME.pollSeconds)).toBe(false);
    expect(isStale(state.sample, T0 + 60_001, RUNTIME.pollSeconds)).toBe(true);

    // The latch-open failure: a meter that STOPS publishing. No new sample arrives,
    // so nothing calls `applySample` — the decision has to re-derive staleness from
    // the published sample and the clock, or a gate that trusted a cached
    // `stale: false` admits everything at full concurrency while the health
    // surface reports the last known percent.
    expect(decideDispatch(state, PURGE_SWEEPER, RUNTIME, T0 + 60_000).admit).toBe(true);
    const latched = recheck(state, RUNTIME, T0 + 60_001);
    expect(latched.mode).toBe('open');
    expect(latched.stale).toBe(true);

    const staleRefusal = decideDispatch(state, PURGE_SWEEPER, RUNTIME, T0 + 60_001);
    expect(staleRefusal.admit).toBe(false);
    expect(staleRefusal.refusal).toBe('stale');
  });

  it('keeps the breaker closed while the meter keeps publishing, so the two rules do not fight', () => {
    const state = closedState(10, T0);
    expect(recheck(state, RUNTIME, T0 + 30_000)).toBe(state);
    expect(recheck(state, RUNTIME, T0 + 30_000).mode).toBe('closed');
  });

  it('gates on an unusable figure rather than substituting one, which is what homegrown-etl\'s `return 50` did', () => {
    const unusable: MemorySample = { measuredAtMs: T0, usable: false, reading: null };
    const state = applySample(initialBreakerState(), unusable, RUNTIME, T0);

    expect(state.mode).toBe('open');
    const decision = decideDispatch(state, PURGE_SWEEPER, RUNTIME, T0);
    // Not `open` — the distinction is reported, because "the instrument is dead" and
    // "the instrument says nothing usable" are different faults with the same
    // response.
    expect(decision.refusal).toBe('unusable');
    expect(decision.admit).toBe(false);
  });

  it('counts every refusal, so the cost of the gate is visible', () => {
    const open = applySample(initialBreakerState(), sample(95, T0), RUNTIME, T0);
    const refused = decideDispatch(open, PURGE_SWEEPER, RUNTIME, T0);

    expect(refused.state.gatedDispatches).toBe(1);
    // An admission is not a refusal and must not be counted as one.
    expect(decideDispatch(closedState(10, T0), PURGE_SWEEPER, RUNTIME, T0).state.gatedDispatches).toBe(0);
  });
});

describe('the protected list fails closed', () => {
  it('admits a protected site at every zone including red, and still counts its pressure', () => {
    const open = applySample(initialBreakerState(), sample(99, T0), RUNTIME, T0);
    const decision = decideDispatch(open, AUTH_LOGIN, RUNTIME, T0);

    expect(decision.admit).toBe(true);
    expect(decision.state.mode).toBe('open');
    // Bypass stops BLOCKING; it never stops REPORTING. An override that removes
    // the only instrument makes overriding unsurvivable.
    expect(decision.state.gatedDispatches).toBe(0);
  });

  it('admits the meter and the gate themselves, so a dispatch decision can never stop the measurement that informs it', () => {
    const open = applySample(initialBreakerState(), sample(99, T0), RUNTIME, T0);

    expect(decideDispatch(open, BREAKER_METER, RUNTIME, T0).admit).toBe(true);
    expect(decideDispatch(open, BREAKER_GATE, RUNTIME, T0).admit).toBe(true);
    expect(decideDispatch(open, PURGE_SWEEPER, RUNTIME, T0).admit).toBe(false);
  });

  it('treats a site it cannot NAME as breakable, because fail-open here is invisible', () => {
    const open = applySample(initialBreakerState(), sample(99, T0), RUNTIME, T0);

    expect(decideDispatch(open, undefined, RUNTIME, T0).admit).toBe(false);
    expect(decideDispatch(open, 'not.protected', RUNTIME, T0).admit).toBe(false);
    // A rename that removes the site from the protected list silently sheds it —
    // which is why an unknown token is a BOOT error, not a warning.
    expect(decideDispatch(open, 'auth.logon', RUNTIME, T0).admit).toBe(false);
  });

  it('defaults to stop: a site absent from the list is sheddable with no opt-in', () => {
    const closed = closedState(10, T0);

    expect(decideDispatch(closed, 'report.nightly', RUNTIME, T0).admit).toBe(true);
    expect(decideDispatch(applySample(closed, sample(95, T0), RUNTIME, T0), 'report.nightly', RUNTIME, T0).admit).toBe(
      false,
    );
  });
});