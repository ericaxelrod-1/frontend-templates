import type { BreakerThresholds } from './breaker-thresholds.js';
import { classifyZone, isProbeWorthy } from './breaker-thresholds.js';
import type { DispatchToken } from './dispatch-token.js';
import type { MemoryReading } from './memory-reading.js';

/**
 * One trip signal, one machine (rebase.md §9B.7).
 *
 * ```
 *   closed ──red──▶ open ──cooldown elapsed AND below yellow──▶ half_open
 *     ▲               ▲                                            │
 *     └── probe ok ───┴──── probe failed / timed out ───────────────┘
 * ```
 *
 * Two rules close the latch-open failure that §9B.6 is built around, and they are
 * deliberately different kinds of mechanism:
 *
 *   1. **the meter and the gate are separate jobs on separate schedules**, so a
 *      dispatch decision can never stop the measurement that informs it;
 *   2. **an instrument that cannot see the resource stops the gate** — whether it
 *      has stopped publishing (`stale`) or is alive and reporting nothing
 *      (`usable: false`). A monitor that has lost the resource cannot claim the
 *      resource is fine.
 *
 * ## And the one state rule 2 must NOT cover
 *
 * Rule 2 is about an instrument that has lost the resource. It says nothing about
 * an instrument that has not reported yet, and conflating the two is the
 * **cold-start window**: `initialBreakerState()` used to answer `stale: true`
 * with `sample: null`, so between process start and the first meter tick — one
 * `BREAKER_POLL_SECONDS`, 30 s by default — every non-protected dispatch site was
 * refused with `202`. A process alive for 300 ms had not failed to measure
 * anything; it had not measured yet.
 *
 * So `sample === null` is its own condition, distinct from `stale`, and it is not
 * a refusal. `BreakerMeter.onApplicationBootstrap` takes the first reading before
 * it registers its interval, and Nest awaits every bootstrap hook before it opens
 * the listener, so "never measured" is the state *before* an app can serve a
 * request over HTTP, not a state it serves from. A meter that runs and cannot
 * produce a figure publishes `usable: false` — never `null` — and is refused.
 *
 * Everything in this file is pure. The mutating half of the breaker is the gate
 * service, which owns exactly one `AbortController` per live dispatch lease, and
 * nothing else constructs one (enforced by ESLint, `AGENTS.md` §3).
 */

export type BreakerMode = 'closed' | 'open' | 'half_open';

/** What the meter publishes. `usable: false` is a live meter with no figure. */
export type MemorySample = {
  readonly measuredAtMs: number;
  readonly usable: boolean;
  readonly reading: MemoryReading | null;
};

export type BreakerState = {
  readonly mode: BreakerMode;
  /** Set on the transition into `open`; `null` while closed. The cooldown anchor. */
  readonly openedAtMs: number | null;
  readonly probeInFlight: boolean;
  readonly probeStartedAtMs: number | null;
  readonly sample: MemorySample | null;
  /**
   * The meter's last reading is older than `2 × BREAKER_POLL_SECONDS`. True means
   * the meter itself has stopped publishing, which is distinct from `usable:
   * false` — one is a dead instrument, the other is a live one reporting nothing.
   */
  readonly stale: boolean;
  readonly gatedDispatches: number;
  readonly stoppedDispatches: number;
};

/** Everything the state machine needs from configuration, as one value. */
export type BreakerRuntime = {
  readonly thresholds: BreakerThresholds;
  readonly pollSeconds: number;
  readonly cooldownSeconds: number;
  readonly probeTimeoutSeconds: number;
  readonly protectedTokens: readonly DispatchToken[];
};

export function initialBreakerState(): BreakerState {
  return {
    // NOT `open`. `open` before the first reading is the cold-start defect, and
    // `stale: true` beside a `sample: null` is the half of it that actually
    // refused the work: `decideDispatch` recomputes staleness itself, so the
    // cached flag was a report and the recomputation was the decision.
    //
    // The process is alive and has simply not measured yet. `openedAtMs` stays
    // null for the same reason it always did — "has never been opened", not
    // "opened at the epoch" — so the first settled reading still CLOSES rather
    // than sitting out a cooldown against an opening that never happened.
    mode: 'closed',
    openedAtMs: null,
    probeInFlight: false,
    probeStartedAtMs: null,
    sample: null,
    // `false`, because there is nothing to be stale. See `isStale`.
    stale: false,
    gatedDispatches: 0,
    stoppedDispatches: 0,
  };
}

/**
 * `2 × BREAKER_POLL_SECONDS`: the reading is stale, and therefore unknown.
 *
 * **`null` is not stale.** Nothing has been measured, so nothing can have gone
 * quiet, and the two are different faults: one is an instrument that has died,
 * the other is an instrument that has not spoken yet. Answering `true` for the
 * second refused every non-protected dispatch for the first poll interval of
 * every process's life, on a machine that was not under any pressure at all.
 *
 * The dead-instrument refusal therefore lives on a sample that EXISTS and is
 * older than the window; the never-measured case is decided where it belongs, in
 * `decideDispatch`.
 */
export function isStale(sample: MemorySample | null, nowMs: number, pollSeconds: number): boolean {
  if (sample === null) {
    return false;
  }
  return nowMs - sample.measuredAtMs > stalenessWindowMs(pollSeconds);
}

/** `2 × BREAKER_POLL_SECONDS`: the reading is stale, and therefore unknown. */
export function stalenessWindowMs(pollSeconds: number): number {
  return pollSeconds * 2 * 1000;
}

function openNow(previous: BreakerState, nowMs: number): BreakerState {
  return {
    ...previous,
    mode: 'open',
    // `openedAtMs` is written ONCE, on the transition into open, and never
    // re-stamped by a sample that is merely still red — otherwise a cooldown that
    // restarts on every tick is a breaker that never leaves open.
    openedAtMs: previous.openedAtMs ?? nowMs,
    probeInFlight: false,
    probeStartedAtMs: null,
  };
}

/**
 * Re-derive staleness from the published sample, WITHOUT a new sample.
 *
 * **This is the latch-open defence, and it cannot live in `applySample`.** The
 * failure it prevents is a meter that STOPS publishing: no sample arrives, so
 * nothing recomputes the flag, and a gate that trusted a cached `stale: false`
 * would admit everything at full concurrency while the health surface cheerfully
 * reported the last known percent. Nothing in the system would be checking
 * whether the reading is current.
 *
 * So staleness is a function of `(sample, now, pollSeconds)` and is evaluated
 * wherever a decision is made — here, in the gate's tick, and again in
 * `decideDispatch` itself, which never trusts a cached flag.
 *
 * A `sample === null` passes through untouched whatever the clock says: there is
 * no `measuredAtMs` to have aged, and a `recheck` that opened the gate for a
 * meter that has simply not published would reintroduce the cold-start window
 * from the other direction — a gate flipping itself `open` on a timer.
 */
export function recheck(previous: BreakerState, runtime: BreakerRuntime, nowMs: number): BreakerState {
  const stale = isStale(previous.sample, nowMs, runtime.pollSeconds);
  if (stale === previous.stale) {
    return previous;
  }
  if (stale) {
    return openNow({ ...previous, stale }, nowMs);
  }
  return { ...previous, stale };
}

/** One meter tick's worth of transition. Pure. */
export function applySample(
  previous: BreakerState,
  sample: MemorySample,
  runtime: BreakerRuntime,
  nowMs: number,
): BreakerState {
  const stale = isStale(sample, nowMs, runtime.pollSeconds);
  const carried: BreakerState = { ...previous, sample, stale };
  const reading = sample.reading;

  if (stale || sample.reading === null || reading === null || !sample.usable) {
    return openNow(carried, nowMs);
  }
  if (classifyZone(reading.percent, runtime.thresholds) === 'red') {
    return openNow(carried, nowMs);
  }
  if (previous.mode === 'open' && previous.openedAtMs !== null) {
    // A REAL opening is in force: `openedAtMs` was stamped by a trip. Both
    // half-open conditions must hold before anything is re-admitted.
    const openedAtMs = previous.openedAtMs;
    if (isProbeWorthy(reading.percent, runtime.thresholds, openedAtMs, nowMs, runtime.cooldownSeconds)) {
      return { ...carried, mode: 'half_open', openedAtMs, probeInFlight: false, probeStartedAtMs: null };
    }
    return { ...carried, mode: 'open', openedAtMs, probeInFlight: false, probeStartedAtMs: null };
  }
  if (previous.mode === 'half_open') {
    // The probe has not reported yet, so a settled reading neither closes the
    // breaker nor re-probes it. Only `completeProbe` or `expireProbe` moves it.
    return carried;
  }
  // No opening has ever been stamped — this is the pre-measurement `open`, not an
  // opening. A fresh, usable reading below red therefore CLOSES the breaker, so a
  // healthy process is closed from its first tick rather than waiting out a
  // cooldown against an opening that never happened.
  return { ...carried, mode: 'closed', openedAtMs: null };
}

export type DispatchRefusal = 'open' | 'probe_in_flight' | 'stale' | 'unusable';

export type DispatchDecision = {
  readonly admit: boolean;
  /** True when this admission is the single half-open probe. */
  readonly probe: boolean;
  readonly state: BreakerState;
  /** Why a refusal happened. `null` whenever `admit` is true. */
  readonly refusal: DispatchRefusal | null;
};

/**
 * The gate. ONE decision, consulted by every dispatch site.
 *
 * **GATE is universal and carries no per-call-site configuration**, because a
 * gate with an opt-out is a gate with a support ticket behind it — and the opt-out
 * is always added during the incident it was needed for, by the person least able
 * to think about the consequences. `BREAKER_PROTECTED` is the whole of the
 * exception surface, and it is a *protection* list, so an exception is additive
 * and reviewed rather than subtractive and forgotten.
 *
 * A protected site is admitted at **every** zone including `red`, and its
 * pressure is still reported: bypass stops BLOCKING, it never stops REPORTING. An
 * override that removes the only instrument makes overriding unsurvivable.
 *
 * A site this build cannot name passes `undefined` and is therefore NOT
 * protected — fail closed, in the direction where being wrong is visible.
 */
export function decideDispatch(
  state: BreakerState,
  token: DispatchToken | undefined,
  runtime: BreakerRuntime,
  nowMs: number,
): DispatchDecision {
  if (token !== undefined && runtime.protectedTokens.includes(token)) {
    return { admit: true, probe: false, state, refusal: null };
  }
  const refuse = (refusal: DispatchRefusal): DispatchDecision => ({
    admit: false,
    probe: false,
    state: { ...state, gatedDispatches: state.gatedDispatches + 1 },
    refusal,
  });
  // **"No reading has ever been taken" is not "the meter is dead", and it is
  // decided here, before anything else.**
  //
  // The cold-start window: a process alive for 300 ms has not failed to measure
  // anything, so it must not be refused for it. There is no `measuredAtMs` to
  // have aged — `isStale` answers `false` for `null` on purpose — and an
  // instrument that runs and cannot produce a figure publishes `usable: false`,
  // which is a sample and is refused below. So this branch is reached only
  // before the meter's first reading, which the meter takes during bootstrap.
  //
  // `state.mode === 'closed'` is not a formality. Every transition that opens the
  // breaker — `applySample` and `recheck` — carries a sample, so a null sample
  // implies `closed` by construction; the check turns an implicit invariant into
  // an enforced one, so a state that somehow claimed to be open with nothing
  // measured is refused rather than admitted on the strength of an assumption.
  if (state.sample === null) {
    return state.mode === 'closed'
      ? { admit: true, probe: false, state, refusal: null }
      : refuse('open');
  }
  // Recomputed here rather than read off the state: `decideDispatch` is the
  // decision, so it cannot depend on somebody else having refreshed a cached flag.
  if (isStale(state.sample, nowMs, runtime.pollSeconds)) {
    return refuse('stale');
  }
  // A sample EXISTS from here on — the branch above returned — so the optional
  // chain is gone and the post-condition is in the expression rather than in a
  // reader's memory. `usable: false` with a null reading is the live-meter-with-no-
  // figure case, and it gates.
  if (state.sample.usable !== true) {
    return refuse('unusable');
  }
  if (state.mode === 'open') {
    return refuse('open');
  }
  if (state.mode === 'half_open') {
    if (state.probeInFlight) {
      return refuse('probe_in_flight');
    }
    // Exactly ONE admission. Not a fraction of the previous concurrency: N
    // re-creates the load that tripped the breaker, and a percentage of it is the
    // same design with a rounding error attached — in the wrong direction.
    return {
      admit: true,
      probe: true,
      state: { ...state, probeInFlight: true, probeStartedAtMs: nowMs },
      refusal: null,
    };
  }
  return { admit: true, probe: false, state, refusal: null };
}

export type ProbeOutcome = 'succeeded' | 'failed' | 'timed_out' | 'aborted';

/**
 * What the probe reported.
 *
 * `aborted` and `timed_out` are distinct from `failed` only in the snapshot's
 * counters, and they deliberately share the transition: the breaker cannot tell
 * the difference operationally, and a breaker that could would be deciding on
 * information it does not have.
 */
export function completeProbe(state: BreakerState, outcome: ProbeOutcome, nowMs: number): BreakerState {
  const released: BreakerState = { ...state, probeInFlight: false, probeStartedAtMs: null };
  if (outcome === 'succeeded') {
    return { ...released, mode: 'closed', openedAtMs: null };
  }
  // The cooldown restarts from NOW — a probe that failed has told us the pressure
  // is still there, and re-probing on the old schedule is the flap §9B.7 refuses.
  return { ...released, mode: 'open', openedAtMs: nowMs };
}

/**
 * The gate's own tick: a probe that never reported is a probe that failed.
 *
 * Without this, a half-open breaker whose probe process died stays in half_open
 * with `probeInFlight` true forever, and — because the only admission is the
 * probe — the system latches CLOSED-ish forever with no admission and no alarm.
 */
export function expireProbe(state: BreakerState, runtime: BreakerRuntime, nowMs: number): BreakerState {
  if (state.mode !== 'half_open' || !state.probeInFlight || state.probeStartedAtMs === null) {
    return state;
  }
  if (nowMs - state.probeStartedAtMs <= runtime.probeTimeoutSeconds * 1000) {
    return state;
  }
  return completeProbe(state, 'timed_out', nowMs);
}