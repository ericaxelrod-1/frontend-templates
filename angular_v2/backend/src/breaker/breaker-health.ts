import type { MemoryZone } from './breaker-thresholds.js';
import { classifyZone } from './breaker-thresholds.js';
import type { BreakerRuntime, BreakerState } from './breaker-state.js';
import type { DispatchToken } from './dispatch-token.js';
import type { MemorySource } from './memory-reading.js';

/**
 * The health surface, as counts against named thresholds.
 *
 * **There is no aggregate `status` field, and one is not going to be added.**
 * There is no correct function from N independent booleans to a three-state enum:
 * "refuse everything that allocates" and "refuse nothing" are different verdicts
 * about different resources, and an enum forces one of them to lie. The legacy
 * collapsed one scalar — the DISK percentage, which its own dispatcher never
 * consulted — onto `NORMAL | WARNING | CRITICAL | PANIC` (`system-health.service.ts:119`,
 * `:158-172`), which is why a completely saturated process reported `NORMAL`.
 *
 * Each signal is reported next to the threshold it is measured against, so a
 * reader never has to remember a number to know which side of it the value is.
 * `test/unit/breaker/breaker-health.spec.ts` asserts this key set by name, which
 * is what turns "no aggregate severity" from an intention into a red test.
 *
 * ## Why this is neither a Nest controller nor a PostgREST table
 *
 * Both were considered and both are wrong here, for reasons that are specific to
 * this architecture rather than to taste.
 *
 * **Not a controller.** The thin app's routes are authenticated but NOT
 * authorized — `jwt-auth.guard.ts` states outright that permission and revocation
 * belong to PostgREST and `db-pre-request` — and a guard is application code, so
 * a `system_health:read` check would have to live in the thin app too. That is a
 * real capability decision with a real answer (a new permission row, a migration,
 * and a re-check inside the service), and it belongs to whoever owns the migration
 * directory: **this change may not write migrations.** Shipping the route before
 * that decision exists would put every authenticated member's memory pressure and
 * every breaker state on the wire — including an anonymous prober's timing of when
 * the system is weak.
 *
 * **Not a PostgREST-served table.** A table is the right home for CRUD over rows
 * (§B1), and this is not CRUD over rows: there is no primary key, no row identity
 * and no history requirement, and the value is a *live measurement of this
 * process*. Persisting it creates a row that is stale the moment the process dies
 * — which is §2.1's "looks finished and isn't" wearing a schema — and a second
 * copy of the resource state that a fork's RLS then has to protect.
 *
 * So the surface is: this snapshot, emitted as a structured log line by the meter
 * on every tick (the instrument that has to exist regardless of whether anyone
 * routes to it), plus `BreakerRegistry` for whatever authorized surface a forker
 * builds on top of it. `docs/rebase.md` W72 remains the work item for the route,
 * and it correctly names the permission row it needs.
 */
export type MemoryHealth = {
  readonly used_bytes: number | null;
  readonly limit_bytes: number | null;
  readonly percent: number | null;
  /** Which world the denominator came from. "90 %" means nothing without it. */
  readonly source: MemorySource | null;
  /** Counted against `green` / `red`; `yellow` is the CLEAR threshold, not a band edge. */
  readonly zone: MemoryZone | null;
  readonly measured_at: string | null;
  /**
   * False when the meter is alive and the figure is unreadable. Distinct from
   * `breaker.stale_reading`, which is the meter itself having stopped.
   */
  readonly usable: boolean;
};

/**
 * Disk, measured and reported, and never a trip input.
 *
 * The app cleans up its own logs and its own temp files; everything else on the
 * volume belongs to the OS, to Postgres or to the operator. A disk trip would
 * convert a condition with an obvious manual remedy (`df -h`) into an automated
 * refusal that hides the condition while it is still true — and it asks the app to
 * refuse work it was never the right party to refuse, using a lever it does not
 * hold. `bavail`, not `bfree`: `bfree` counts blocks reserved for root that this
 * process may not use, so it overstates what is actually available.
 *
 * The limitation is stated rather than hidden: this is THIS filesystem. If
 * Postgres is on another host, this number says nothing about the database, and
 * nothing here may be described as protecting it. What protects the database is
 * `0007_resource_ceilings.sql` — `statement_timeout`, `lock_timeout`,
 * `idle_in_transaction_session_timeout` — because those sit below both runtimes
 * and cannot be forgotten by a Nest interceptor.
 */
export type DiskHealth = {
  readonly free_bytes: number;
  readonly free_ratio: number;
  readonly measured_at: string;
};

export type BreakerHealth = {
  readonly state: 'closed' | 'open' | 'half_open';
  /** The meter has not published within `2 × BREAKER_POLL_SECONDS`. */
  readonly stale_reading: boolean;
  readonly opened_at: string | null;
  /** Seconds since the breaker opened; `null` while closed. */
  readonly since_seconds: number | null;
  readonly gated_dispatches: number;
  readonly stopped_dispatches: number;
  readonly probe_in_flight: boolean;
  /** Echoed back so an operator can see WHICH sites are exempt at this moment. */
  readonly protected: readonly DispatchToken[];
};

export type BreakerHealthSnapshot = {
  readonly memory: MemoryHealth;
  readonly disk: DiskHealth;
  readonly breaker: BreakerHealth;
};

export type DiskSample = {
  readonly freeBytes: number;
  readonly freeRatio: number;
};

export function buildHealthSnapshot(
  state: BreakerState,
  runtime: BreakerRuntime,
  disk: DiskSample,
  nowMs: number,
): BreakerHealthSnapshot {
  const reading = state.sample?.reading ?? null;
  const measuredAtMs = state.sample?.measuredAtMs ?? null;
  return {
    memory: {
      used_bytes: reading?.usedBytes ?? null,
      limit_bytes: reading?.limitBytes ?? null,
      percent: reading === null ? null : round(reading.percent),
      source: reading?.source ?? null,
      zone: reading === null ? null : classifyZone(reading.percent, runtime.thresholds),
      measured_at: measuredAtMs === null ? null : new Date(measuredAtMs).toISOString(),
      usable: state.sample?.usable === true && reading !== null,
    },
    disk: {
      free_bytes: disk.freeBytes,
      free_ratio: round(disk.freeRatio),
      measured_at: new Date(nowMs).toISOString(),
    },
    breaker: {
      state: state.mode,
      stale_reading: state.stale,
      opened_at: state.openedAtMs === null ? null : new Date(state.openedAtMs).toISOString(),
      since_seconds:
        state.openedAtMs === null || state.mode === 'closed' ? null : Math.max(0, Math.floor((nowMs - state.openedAtMs) / 1000)),
      gated_dispatches: state.gatedDispatches,
      stopped_dispatches: state.stoppedDispatches,
      probe_in_flight: state.probeInFlight,
      protected: runtime.protectedTokens,
    },
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}