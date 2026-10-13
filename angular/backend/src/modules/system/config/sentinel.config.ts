import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * Name of the disaster-recovery environment flag.
 *
 * FR-015 ("Emergency Overrides"): an operator must be able to get heavy
 * operations running again while the disk is still full. This flag is the
 * documented escape hatch.
 */
export const SENTINEL_GUARD_ENV_VAR = 'DISABLE_SENTINEL_GUARD';

/** Disk utilisation at which each Sentinel tier engages, as a percentage. */
export interface SentinelThresholds {
  /** > this: WARNING (report only, nothing is blocked). */
  readonly warningPercent: number;
  /** >= this: CRITICAL. Heavy routes are refused. */
  readonly criticalPercent: number;
  /** >= this: PANIC. Every write is refused and heavy routes are refused. */
  readonly panicPercent: number;
}

/**
 * The documented defaults from `PRIVACY_COMPLIANCE.md` (90 / 95 / 98). They are
 * defaults, not literals: they are overridable per deployment and every value is
 * validated on construction, so a typo in the environment fails the boot instead
 * of silently disarming a tier.
 */
const DEFAULT_THRESHOLDS: SentinelThresholds = {
  warningPercent: 90,
  criticalPercent: 95,
  panicPercent: 98,
};

const TRUTHY = ['true', '1', 'yes', 'on'];
const FALSY = ['false', '0', 'no', 'off'];

function readPercent(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${envName} must be a finite number, received "${raw}".`);
  }
  if (value <= 0 || value > 100) {
    throw new Error(
      `${envName} must be a percentage within (0, 100], received ${value}.`,
    );
  }
  return value;
}

function readBoolean(envName: string): boolean {
  const raw = process.env[envName];
  if (raw === undefined || raw.trim() === '') {
    return false;
  }

  const normalized = raw.trim().toLowerCase();
  if (TRUTHY.includes(normalized)) {
    return true;
  }
  if (FALSY.includes(normalized)) {
    return false;
  }
  throw new Error(
    `${envName} must be one of ${[...TRUTHY, ...FALSY].join('/')} — ` +
      `received "${raw}". Refusing to guess: a misspelled override must not ` +
      `read as "the guard is off".`,
  );
}

/**
 * Single owner of the Sentinel's tunables.
 *
 * Both the measurement side (`SystemHealthService`, which tiers against
 * `thresholds`) and the enforcement side (`SystemResourceInterceptor`, which
 * reads `guardDisabled`) read them from here, so there is exactly one parse and
 * one validation of each environment variable.
 */
@Injectable()
export class SentinelConfigService implements OnModuleInit {
  private readonly logger = new Logger(SentinelConfigService.name);

  readonly thresholds: SentinelThresholds;
  readonly guardDisabled: boolean;

  constructor() {
    const warningPercent = readPercent(
      'SENTINEL_WARNING_PERCENT',
      DEFAULT_THRESHOLDS.warningPercent,
    );
    const criticalPercent = readPercent(
      'SENTINEL_CRITICAL_PERCENT',
      DEFAULT_THRESHOLDS.criticalPercent,
    );
    const panicPercent = readPercent(
      'SENTINEL_PANIC_PERCENT',
      DEFAULT_THRESHOLDS.panicPercent,
    );

    if (!(warningPercent < criticalPercent && criticalPercent < panicPercent)) {
      throw new Error(
        'Sentinel thresholds must be strictly increasing: ' +
          `SENTINEL_WARNING_PERCENT (${warningPercent}) < ` +
          `SENTINEL_CRITICAL_PERCENT (${criticalPercent}) < ` +
          `SENTINEL_PANIC_PERCENT (${panicPercent}).`,
      );
    }

    this.thresholds = Object.freeze({
      warningPercent,
      criticalPercent,
      panicPercent,
    });
    this.guardDisabled = readBoolean(SENTINEL_GUARD_ENV_VAR);
  }

  onModuleInit(): void {
    if (this.guardDisabled) {
      this.logger.warn(
        `${SENTINEL_GUARD_ENV_VAR} is set: the Sentinel resource guard is ` +
          'DISABLED for this process. Heavy routes and write requests will ' +
          `run even above the ${this.thresholds.criticalPercent}%/` +
          `${this.thresholds.panicPercent}% tiers. The health snapshot still ` +
          'reports the real tier. Unset the variable to re-arm the guard.',
      );
    } else {
      this.logger.log(
        'Sentinel armed: heavy routes blocked at ' +
          `${this.thresholds.criticalPercent}% disk, all writes blocked at ` +
          `${this.thresholds.panicPercent}% disk.`,
      );
    }
  }
}
