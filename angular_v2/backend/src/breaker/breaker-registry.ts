import { Inject, Injectable } from '@nestjs/common';
import type { BreakerEnvironment } from './breaker-environment.js';
import { BREAKER_ENV, breakerRuntimeOf } from './breaker-environment.js';
import type { BreakerRuntime, BreakerState } from './breaker-state.js';
import { initialBreakerState } from './breaker-state.js';

/**
 * The breaker OBJECT.
 *
 * Its absence is one of the four defects in the reference implementation this
 * design came from: there the entire breaker is one `return` inside `processQueue`,
 * so there is nothing for any other code path to consult — a report job, a
 * webhook fan-out, a nightly reconciliation is ungated **by construction**, and no
 * test notices because there is no gate to test. The cost of that is paid at the
 * moment somebody adds work that is not dispatched by that one function.
 *
 * One instance, registered once (`AGENTS.md` §2.4). The meter writes, the gate and
 * every dispatch site read, and the health snapshot reads. Node's single-threaded
 * execution makes read-modify-write atomic here without a lock, which is recorded
 * because it is the kind of assumption that stops being true the moment this is
 * moved onto more than one process — at which point this class needs to be backed
 * by something shared.
 *
 * The state STARTS **closed and unmeasured** — `sample: null`, `stale: false` —
 * and the two are one design decision. "No reading has ever been taken" is not
 * "the meter is dead": nothing can have gone quiet before anything has spoken,
 * so treating the pre-measurement state as a stale one refused every
 * non-protected dispatch with `202` for the first `BREAKER_POLL_SECONDS` of every
 * process's life. The fail-closed case is a sample that EXISTS and has aged past
 * the staleness window, and `BreakerMeter` takes its first reading during
 * bootstrap so this state is not what a serving process runs from.
 */
@Injectable()
export class BreakerRegistry {
  readonly runtime: BreakerRuntime;
  private state: BreakerState = initialBreakerState();

  constructor(@Inject(BREAKER_ENV) env: BreakerEnvironment) {
    this.runtime = breakerRuntimeOf(env);
  }

  get(): BreakerState {
    return this.state;
  }

  /** The whole state is replaced, never patched in place, so it is always a snapshot. */
  publish(state: BreakerState): void {
    this.state = state;
  }
}