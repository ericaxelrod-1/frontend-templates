/**
 * The sweeper's decision logic, with no database in it.
 *
 * Every question this file answers — *may this tick start another purge?* — is
 * answered from values it was handed, so the whole of the drain budget and the
 * gate interaction is unit-testable against nothing but numbers. That isolation is
 * not tidiness: it is what makes the budget and the gate **provable** without a
 * cluster, in a repository whose integration run cannot be executed from the
 * machine this change was written on.
 *
 * ## The two bugs this shape is built to make impossible
 *
 * **1 — an unbounded tick.** The legacy drained its queue with `@Cron` around a
 * `while (true)` loop, so one tick could run until the queue emptied, the interval
 * would fire again mid-drain, and two ticks overlapped and raced for the same
 * rows. A budget turns "run until done" into "run at most N, then yield". The work
 * that is left is still in the queue at the next tick — nothing is lost and
 * nothing is claimed twice, because a claim lives inside the same transaction as
 * the work it authorises and a rolled-back claim releases its row lock.
 *
 * **2 — a gate that gates nothing.** A gate consulted once per *tick* can be
 * closed by the breaker a microsecond after that consultation, and the rest of the
 * drain runs anyway. So the question is asked again for **every** purge, which is
 * the only place a decision made by a separate job can actually take effect.
 */
export type DrainStepInput = {
  /** Executions still permitted this tick. Never negative. */
  readonly budgetRemaining: number;
  /** Whether the gate admitted this dispatch at all. */
  readonly admit: boolean;
  /** True when this admission is the single half-open probe. */
  readonly probe: boolean;
  /** The abort handle, already signalled. */
  readonly aborted: boolean;
};

export type DrainStepOutcome = 'attempt' | 'gated' | 'aborted' | 'budget_exhausted';

export type DrainStep = {
  readonly attempt: boolean;
  readonly outcome: DrainStepOutcome;
  /**
   * In half-open, the allowance is exactly one purge for the whole tick — not one
   * per iteration. A probe that drained a batch would recreate the pressure that
   * opened the breaker, and one is the only admission count that is safe *by
   * construction*.
   */
  readonly probeOnly: boolean;
};

/**
 * One decision, pure and total, never throwing.
 *
 * The order of the checks IS the behaviour:
 *
 * 1. **nothing permitted** — the budget is spent, so stop and let the next tick
 *    pick the rest up;
 * 2. **aborted** — a stoppable dispatch whose signal has fired does not *start*
 *    new work. That is the "aborting leaves no partial state" criterion in the
 *    form that matters: nothing begins, so nothing can be left behind. It is
 *    checked before the gate so an abort reads as an abort rather than as a
 *    refusal;
 * 3. **gated** — the breaker refused this dispatch; nothing runs, probe
 *    allowance included, because a refusal is a refusal of the dispatch rather
 *    than of everything except one.
 *
 * The gate is asked per iteration, so a breaker that opens mid-drain stops the
 * drain at the next purge instead of at the end of it.
 */
export function planDrainStep(input: DrainStepInput): DrainStep {
  const probeOnly = input.probe;
  if (input.budgetRemaining <= 0) {
    return { attempt: false, outcome: 'budget_exhausted', probeOnly };
  }
  if (input.aborted) {
    return { attempt: false, outcome: 'aborted', probeOnly };
  }
  if (!input.admit) {
    return { attempt: false, outcome: 'gated', probeOnly };
  }
  return { attempt: true, outcome: 'attempt', probeOnly };
}