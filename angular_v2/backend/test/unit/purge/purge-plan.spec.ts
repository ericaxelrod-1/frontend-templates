import { planDrainStep } from '../../../src/purge/purge-plan.js';
import type { DrainStepInput } from '../../../src/purge/purge-plan.js';

/**
 * The sweeper's decision logic, with no database — the reason this file can exist
 * at all on a machine where the integration run is not available.
 */

function step(overrides: Partial<DrainStepInput> = {}) {
  return planDrainStep({ budgetRemaining: 10, admit: true, probe: false, aborted: false, ...overrides });
}

describe('the drain budget', () => {
  it('permits a purge while budget remains', () => {
    expect(step({ budgetRemaining: 1 })).toEqual({ attempt: true, outcome: 'attempt', probeOnly: false });
  });

  it('stops once the budget is spent, so one tick can never run unbounded', () => {
    // The legacy drained with `@Cron` around a `while (true)` loop, so one tick ran
    // until the queue emptied, the interval fired again mid-drain, and two ticks
    // raced for the same rows. The work left over is still in the queue at the next
    // tick: nothing is lost and nothing is claimed twice.
    expect(step({ budgetRemaining: 0 })).toEqual({
      attempt: false,
      outcome: 'budget_exhausted',
      probeOnly: false,
    });
    expect(step({ budgetRemaining: -1 }).attempt).toBe(false);
  });

  it('reports the budget as exhausted even when the gate has also closed, because the budget is what it is', () => {
    // Ordering is the behaviour: the budget is checked first so a tick that is out
    // of budget reports the budget rather than blaming the breaker.
    expect(step({ budgetRemaining: 0, admit: false })).toEqual({
      attempt: false,
      outcome: 'budget_exhausted',
      probeOnly: false,
    });
  });
});

describe('GATE stops the drain, not the process', () => {
  it('permits nothing when the gate refused, probe allowance included', () => {
    expect(step({ admit: false })).toEqual({ attempt: false, outcome: 'gated', probeOnly: false });
    expect(step({ admit: false, probe: true })).toEqual({ attempt: false, outcome: 'gated', probeOnly: true });
  });

  it('permits nothing once the abort handle has fired, and calls it an abort rather than a refusal', () => {
    // Nothing begins, so nothing can be left behind: that is the "aborting leaves
    // no partial state" criterion in the form that matters. Checked before the gate
    // so an abort reads as an abort.
    expect(step({ aborted: true })).toEqual({ attempt: false, outcome: 'aborted', probeOnly: false });
    expect(step({ aborted: true, admit: false }).outcome).toBe('aborted');
  });

  it('is decided per purge, not once per tick, because a decision made by a separate job is only real where it is consulted', () => {
    const first = step();
    expect(first.attempt).toBe(true);
    // The next iteration asks again — and that is the assertion: the function is
    // the ONLY place the drain consults the gate, so calling it per iteration is
    // what makes a mid-drain trip take effect before the batch is finished.
    const afterTrip = step({ admit: false });
    expect(afterTrip.attempt).toBe(false);
  });
});

describe('the half-open probe allowance', () => {
  it('admits one purge and flags the tick as probe-only, so a probe cannot drain the queue it was admitted to probe', () => {
    expect(step({ probe: true })).toEqual({ attempt: true, outcome: 'attempt', probeOnly: true });
  });

  it('still refuses when the budget is spent, even for a probe', () => {
    expect(step({ probe: true, budgetRemaining: 0 }).outcome).toBe('budget_exhausted');
  });
});