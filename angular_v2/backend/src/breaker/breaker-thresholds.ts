/**
 * Three bands, three thresholds, and the band edges are NOT the same thing as
 * the trip condition (rebase.md §9B.3, §9B.7).
 *
 * ```
 *   green  |  percent < green
 *   yellow |  green <= percent < red        <- elevated, still admitted
 *   red    |  red <= percent
 * ```
 *
 * `YELLOW` is the **clear** threshold, not a trip threshold, and that is exactly
 * why this design has no `CLEAR_RATIO` key: hysteresis here is three bands
 * written down rather than two thresholds plus a ratio somebody chose. `OPEN` is
 * entered at or above `RED`; `HALF_OPEN` requires a reading below `YELLOW`. Every
 * configured number therefore decides something — a build where `YELLOW` is not
 * read would be a config key that exists and does nothing (§2.1).
 *
 * The rejection to note: `90/60/60` boots without a syntax error and yields a
 * breaker whose red zone is never above yellow and whose yellow band is empty, so
 * it never trips — on a machine reporting itself healthy, with no warning. The
 * defence is to refuse the configuration at boot, which is why the ordering
 * `green < yellow < red` is asserted in `breaker-environment.ts` and not merely
 * documented.
 *
 * There is deliberately no aggregate `severity` here or anywhere downstream: N
 * independent booleans do not reduce to a three-state enum, and the enum is what
 * made the legacy's health service (`system-health.service.ts:119`) collapse a
 * saturation signal it never even measured into `NORMAL`.
 */

export type MemoryZone = 'green' | 'yellow' | 'red';

export type BreakerThresholds = {
  readonly green: number;
  readonly yellow: number;
  readonly red: number;
};

export function classifyZone(percent: number, thresholds: BreakerThresholds): MemoryZone {
  if (percent >= thresholds.red) {
    return 'red';
  }
  if (percent >= thresholds.green) {
    return 'yellow';
  }
  return 'green';
}

/**
 * Whether a reading is settled enough to be probed.
 *
 * Both halves of the half-open condition live here so they cannot drift apart:
 * below `YELLOW` **and** out of cooldown. Time alone re-probes into the same
 * spike on the tick after the cooldown expires; the reading alone re-probes on
 * every tick during the spike, because a momentary reading below `RED` in a
 * rising trend is common. Together they mean *settled*, which is what a probe
 * needs (rebase.md §9B.7).
 */
export function isProbeWorthy(
  percent: number,
  thresholds: BreakerThresholds,
  openedAtMs: number,
  nowMs: number,
  cooldownSeconds: number,
): boolean {
  return percent < thresholds.yellow && nowMs - openedAtMs >= cooldownSeconds * 1000;
}