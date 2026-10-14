import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { BreakerEnvironment } from './breaker-environment.js';
import { BREAKER_ENV, GATE_INTERVAL_OFFSET_MS } from './breaker-environment.js';
import { BreakerRegistry } from './breaker-registry.js';
import type { BreakerState, DispatchRefusal, ProbeOutcome } from './breaker-state.js';
import { completeProbe, decideDispatch, expireProbe, recheck } from './breaker-state.js';
import { BREAKER_GATE } from './dispatch-token.js';
import type { DispatchToken } from './dispatch-token.js';

/**
 * `breaker.gate` — the decision, and the only place an `AbortController` is born.
 *
 * Two responses, and the distinction between them is the whole point:
 *
 * |                | GATE                                | STOP                                  |
 * |----------------|-------------------------------------|---------------------------------------|
 * | meaning        | never start new work                | abort work in flight                  |
 * | scope          | universal, no configuration         | only sites that declared themselves   |
 * |                |                                     | individually recoverable              |
 *
 * **Both are dispatch gates, and neither is an HTTP error.** The work is not
 * running; it has not been rejected. A `503` would say *your request failed*,
 * which is false, and it costs three second-order things exactly when the machine
 * can least absorb them: clients retry into the one component whose job is
 * admitting work, the caller has nothing to wait on, and the operator's dashboard
 * fills with errors that are not errors while the signal that matters competes
 * for attention.
 *
 * **GATE is universal precisely because it has no opt-out.** A gate with an
 * opt-out is a gate with a support ticket behind it, and the opt-out is always
 * added during the incident it was needed for, by the person least able to think
 * about the consequences. `BREAKER_PROTECTED` is the whole exception surface and
 * it is a *protection* list, so an exception is additive and reviewed rather than
 * subtractive and forgotten.
 *
 * **STOP is a contract, not a flag.** A site is stoppable because it takes an
 * `AbortSignal` and its acceptance test is *"aborting leaves no partial state"* —
 * a flag would make "is this safe to abort?" a deployment-time opinion, while a
 * contract makes it a compile-time fact with a test attached. Only one of those
 * fails before production.
 */
/**
 * What a dispatch reports when it finishes.
 *
 * `completed` and `succeeded` are the same event seen from two sides: a lease that
 * was never the probe has nothing to report to the state machine, and only a probe's
 * outcome can move the breaker.
 */
export type DispatchOutcome = ProbeOutcome | 'completed';

export type DispatchLease = {
  readonly token: DispatchToken | undefined;
  /** True when this admission is the single half-open probe. */
  readonly probe: boolean;
  /**
   * The abort handle, present **only** for a stoppable site. `undefined` is not
   * "not aborted yet": it is "this site cannot be aborted", and the gate will
   * never abort one.
   */
  readonly signal: AbortSignal | undefined;
  /** Called exactly once by the owner when the dispatch finishes. */
  release(outcome: DispatchOutcome): void;
};

export type DispatchAdmission =
  | { readonly admit: true; readonly lease: DispatchLease }
  | { readonly admit: false; readonly refusal: DispatchRefusal; readonly state: BreakerState };

type LiveLease = {
  readonly token: DispatchToken | undefined;
  readonly controller: AbortController;
};

@Injectable()
export class BreakerGate implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BreakerGate.name);
  private readonly live = new Set<LiveLease>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly registry: BreakerRegistry,
    @Inject(BREAKER_ENV) private readonly env: BreakerEnvironment,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /**
   * A schedule of its own, offset from the meter's by a constant rather than
   * configured separately: a second key is a second number to get wrong, and this
   * one changes no decision — only when the gate re-reads what the meter
   * published. The offset is not a multiple of the meter period, so the two do
   * not land together and the gate does not always read a reading that is up to a
   * full poll interval old.
   */
  onApplicationBootstrap(): void {
    const periodMs = this.env.pollSeconds * 1000 + GATE_INTERVAL_OFFSET_MS;
    const timer = setInterval(() => {
      this.tick();
    }, periodMs);
    timer.unref();
    this.timer = timer;
    this.scheduler.addInterval(BREAKER_GATE, timer);
    this.logger.log(`breaker.gate ticks every ${periodMs / 1000}s, offset from breaker.meter`);
  }

  onModuleDestroy(): void {
    const timer = this.timer;
    this.timer = undefined;
    if (timer !== undefined) {
      clearInterval(timer);
    }
    if (this.scheduler.doesExist('interval', BREAKER_GATE)) {
      this.scheduler.deleteInterval(BREAKER_GATE);
    }
    // Nothing is left half-aborted at shutdown: every live handle is aborted so a
    // caller waiting on one is told, rather than being released silently.
    this.stopInFlight('shutdown');
  }

  /**
   * The gate's own tick. Its **entire input is the meter's last published
   * state**; it performs no measurement of its own, and it is protected, so
   * nothing the gate decides can stop it from ticking.
   *
   * Three jobs, in order:
   *
   * 1. re-derive staleness from what was last published, so a meter that stopped
   *    publishing gates rather than admits (the latch-open failure);
   * 2. expire a probe that never reported — a half-open breaker whose only
   *    admission is the probe would otherwise latch forever with no admission and
   *    no alarm;
   * 3. **STOP** every live stoppable dispatch once the state is `open`.
   *
   * The third is why the two jobs are separate rather than one: STOP needs a
   * trigger, and the trigger is a change in the *published* state. A meter that
   * only sampled at dispatch time would have no "after" to react to.
   */
  tick(nowMs: number = Date.now()): void {
    // Refreshed BEFORE the expiry check, because a meter that stopped publishing
    // is exactly the case where there is no new sample for `expireProbe` to look
    // at, and a gate that trusted the last cached `stale` would admit everything.
    const refreshed = recheck(this.registry.get(), this.registry.runtime, nowMs);
    if (refreshed !== this.registry.get()) {
      this.registry.publish(refreshed);
      this.logger.warn('breaker.gate: the meter has not published within 2 × BREAKER_POLL_SECONDS; treating the reading as unmeasured');
    }
    const current = this.registry.get();
    const expired = expireProbe(current, this.registry.runtime, nowMs);
    if (expired !== current) {
      this.registry.publish(expired);
      this.logger.warn(`breaker.gate: the half-open probe did not report within ${this.env.probeTimeoutSeconds}s; re-opened`);
    }
    if (this.registry.get().mode === 'open') {
      this.stopInFlight('breaker open');
    }
  }

  /**
   * The one decision every dispatch site makes.
   *
   * `stoppable` is a statement about the caller's contract, not a switch: a site
   * that asks for a stoppable lease and cannot honour its signal has lied about
   * its recoverability, and the sweeper's acceptance test is what catches that.
   */
  acquire(token: DispatchToken | undefined, stoppable = false, nowMs: number = Date.now()): DispatchAdmission {
    const decision = decideDispatch(this.registry.get(), token, this.registry.runtime, nowMs);
    this.registry.publish(decision.state);
    if (!decision.admit) {
      this.logger.warn(
        `breaker.gate refused dispatch of ${token ?? 'an unnamed site'}: ${decision.refusal} ` +
          `(mode=${decision.state.mode})`,
      );
      return { admit: false, refusal: decision.refusal ?? 'open', state: decision.state };
    }

    // The ONLY `new AbortController()` in the tree, and ESLint says so. A
    // controller constructed and never passed to its consumer is not a timeout, it
    // is a comment — it produces the complete appearance of a recoverable abort
    // and none of the behaviour, and no test stays green against it.
    const controller = stoppable ? new AbortController() : undefined;
    const entry: LiveLease | undefined =
      controller === undefined ? undefined : { token, controller };
    if (entry !== undefined) {
      this.live.add(entry);
    }

    let released = false;
    return {
      admit: true,
      lease: {
        token,
        probe: decision.probe,
        signal: controller?.signal,
        release: (outcome: ProbeOutcome | 'completed'): void => {
          if (released) {
            // A double release would re-apply the probe transition, so a probe that
            // closed the breaker and then reported twice would not be able to
            // re-open it on the second call.
            this.logger.error(`breaker.gate: ${token ?? 'an unnamed site'} released its dispatch lease twice`);
            return;
          }
          released = true;
          if (entry !== undefined) {
            this.live.delete(entry);
          }
          if (decision.probe) {
            // A probe that finished without reporting a failure IS a success; the
            // state machine has no fifth value for "it completed".
            this.registry.publish(
              completeProbe(this.registry.get(), outcome === 'completed' ? 'succeeded' : outcome, Date.now()),
            );
            this.logger.log(
              `breaker.gate: half-open probe ${token ?? 'an unnamed site'} reported '${outcome}'; ` +
                `breaker is now ${this.registry.get().mode}`,
            );
          }
        },
      },
    };
  }

  /**
   * STOP. Aborts every live stoppable dispatch, and only those.
   *
   * The cost of this being unconditional across *stoppable sites* is stated rather
   * than hidden: a forker that adds a service with an abort handle has added a
   * service whose work can be interrupted, and the per-service acceptance criterion
   * ("aborting leaves no partial state") is what makes that safe. There is no
   * runtime setting that turns STOP on for a service that cannot be aborted, and
   * none that exempts one that can — a flag would make the decision a deployment
   * opinion instead of a compile-time fact.
   */
  stopInFlight(reason: string): number {
    if (this.live.size === 0) {
      return 0;
    }
    const entries = [...this.live];
    for (const entry of entries) {
      entry.controller.abort(new Error(`breaker: dispatch aborted (${reason})`));
    }
    const state = this.registry.get();
    this.registry.publish({ ...state, stoppedDispatches: state.stoppedDispatches + entries.length });
    this.logger.warn(`breaker.gate aborted ${entries.length} in-flight dispatch(es): ${reason}`);
    return entries.length;
  }

  /** Live stoppable dispatches, for the snapshot and for tests. */
  liveStoppableCount(): number {
    return this.live.size;
  }
}