/**
 * Progressive-delay and block decisions for the brute-force gate (W11
 * slice 3). Pure functions so the schedule can be asserted without a
 * database, and real short delays can be asserted without a mocked clock.
 *
 * `delayForFailures(k)` maps the number of counted failures to the wait
 * imposed on the next attempt:
 *
 *   k=0 → schedule[0] (0s)      k=1 → schedule[1] (1s)
 *   k=2 → schedule[2] (4s)      k=3+ → schedule[last], clamped to cap
 *
 * The cap is a ceiling on any scheduled entry, so with the default
 * schedule (0,1,4,16, cap 30) the effective top is 16s; a forker who
 * raises the schedule above 30s gets the cap instead.
 *
 * A counter at or past the block threshold is refused before any
 * credential check — the terminal, time-boxed alternative to delays
 * alone (security.md's "five failures" names the threshold). The block
 * lifts when the failures age out of the window, so it cannot lock an
 * account forever; only a party who proves the password clears a penalty
 * outright.
 */

export function delayForFailures(
  failures: number,
  schedule: readonly number[],
  capSeconds: number,
): number {
  if (failures <= 0) {
    return 0;
  }
  const index = Math.min(failures, schedule.length - 1);
  const seconds = schedule[index] ?? 0;
  return Math.min(seconds, capSeconds) * 1000;
}

export function isBlocked(failures: number, threshold: number): boolean {
  return failures >= threshold;
}
