import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as os from 'os';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  SentinelConfigService,
  SentinelThresholds,
} from '../config/sentinel.config';

export enum HealthStatus {
  NORMAL = 'NORMAL',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  PANIC = 'PANIC',
  /**
   * The last measurement attempt failed. Distinct from NORMAL on purpose: a
   * `statfs` failure used to leave `currentStatus` at its previous value, which
   * made "the disk is fine" indistinguishable from "we could not look".
   */
  UNKNOWN = 'UNKNOWN',
}

export interface DiskUsage {
  readonly total: number;
  readonly used: number;
  readonly free: number;
  readonly percentage: number;
}

export interface MemoryUsage {
  readonly total: number;
  readonly used: number;
  readonly free: number;
  readonly percentage: number;
  /**
   * This process only. `process.memoryUsage()` is meaningless as a host figure
   * in a multi-instance deployment, so it is reported separately and labelled
   * rather than presented as "system memory".
   */
  readonly process: {
    readonly rss: number;
    readonly heapTotal: number;
    readonly heapUsed: number;
  };
}

export interface SystemHealthSnapshot {
  readonly status: HealthStatus;
  readonly disk: DiskUsage;
  readonly memory: MemoryUsage;
  /** When the Sentinel last *attempted* a check. Null until the first one. */
  readonly lastCheckedAt: string | null;
  /** Non-null when the last attempt failed. Never swallowed. */
  readonly lastError: string | null;
  /** True when DISABLE_SENTINEL_GUARD is set: enforcement off, truth intact. */
  readonly guardDisabled: boolean;
  readonly thresholds: SentinelThresholds;
}

const UNKNOWN_STATUS = (
  guardDisabled: boolean,
  thresholds: SentinelThresholds,
): SystemHealthSnapshot => ({
  status: HealthStatus.UNKNOWN,
  disk: { total: 0, used: 0, free: 0, percentage: 0 },
  memory: {
    total: 0,
    used: 0,
    free: 0,
    percentage: 0,
    process: { rss: 0, heapTotal: 0, heapUsed: 0 },
  },
  lastCheckedAt: null,
  lastError: null,
  guardDisabled,
  thresholds,
});

/**
 * The Sentinel's measurement side.
 *
 * Owns *what is true*; `SystemResourceInterceptor` owns *what is enforced*.
 * The emergency override deliberately does not live here: if this service
 * swallowed DISABLE_SENTINEL_GUARD it would report "Healthy" on a full disk,
 * destroying the only feedback loop the operator has while in override mode.
 */
@Injectable()
export class SystemHealthService implements OnModuleInit {
  private readonly logger = new Logger(SystemHealthService.name);
  private snapshot: SystemHealthSnapshot;

  constructor(private readonly config: SentinelConfigService) {
    this.snapshot = UNKNOWN_STATUS(config.guardDisabled, config.thresholds);
  }

  /**
   * The first measurement is awaited here rather than kicked off from the
   * constructor, so a request never races an un-awaited `statfs`.
   */
  async onModuleInit(): Promise<void> {
    await this.checkDiskSpace();
  }

  async checkDiskSpace(): Promise<void> {
    const checkedAt = new Date().toISOString();

    try {
      // `statfs` on the application's own partition: this is the filesystem the
      // exports, the SQLite file and the logs actually consume.
      const stats = await fs.statfs('.');
      const blockSize = stats.bsize;
      const total = blockSize * stats.blocks;
      // bavail, not bfree: bfree counts blocks reserved for root, which this
      // process may not use, so bfree overstates the space actually available.
      const free = blockSize * stats.bavail;
      const used = total - free;
      const percentage = total > 0 ? (used / total) * 100 : 0;

      const status = this.classify(percentage);

      this.snapshot = {
        ...this.snapshot,
        status,
        disk: { total, used, free, percentage },
        memory: this.measureMemory(),
        lastCheckedAt: checkedAt,
        lastError: null,
      };

      if (status !== HealthStatus.NORMAL) {
        this.logger.warn(
          `Disk usage is high: ${percentage.toFixed(2)}% - Status: ${status}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Fail visibly. The status becomes UNKNOWN rather than staying at its
      // previous value, and the reason is carried on the snapshot so the
      // dashboard and the API response both surface it.
      this.snapshot = {
        ...this.snapshot,
        status: HealthStatus.UNKNOWN,
        memory: this.measureMemory(),
        lastCheckedAt: checkedAt,
        lastError: `Disk check failed: ${message}`,
      };
      this.logger.error(
        `Failed to check disk space; status set to ${HealthStatus.UNKNOWN}: ${message}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  handleCron(): void {
    void this.checkDiskSpace();
  }

  private classify(percentage: number): HealthStatus {
    const { warningPercent, criticalPercent, panicPercent } =
      this.config.thresholds;

    if (percentage >= panicPercent) {
      return HealthStatus.PANIC;
    }
    if (percentage >= criticalPercent) {
      return HealthStatus.CRITICAL;
    }
    if (percentage >= warningPercent) {
      return HealthStatus.WARNING;
    }
    return HealthStatus.NORMAL;
  }

  private measureMemory(): MemoryUsage {
    // Host-wide, the analogue of `statfs` for RAM. os.freemem() is also what
    // the kernel would actually hand a new allocation.
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const usage = process.memoryUsage();

    return {
      total,
      used,
      free,
      percentage: total > 0 ? (used / total) * 100 : 0,
      process: {
        rss: usage.rss,
        heapTotal: usage.heapTotal,
        heapUsed: usage.heapUsed,
      },
    };
  }

  getSnapshot(): SystemHealthSnapshot {
    return this.snapshot;
  }

  getHealthStatus(): HealthStatus {
    return this.snapshot.status;
  }

  getDiskUsage(): number {
    return this.snapshot.disk.percentage;
  }

  /**
   * The CRITICAL tier only: "heavy routes are refused".
   *
   * This used to answer true for PANIC as well, which collapsed the documented
   * ladder (95% blocks exports, 98% blocks all writes) into a single tier.
   */
  isResourceCritical(): boolean {
    return this.snapshot.status === HealthStatus.CRITICAL;
  }

  /** The PANIC tier: "every write is refused". */
  isPanic(): boolean {
    return this.snapshot.status === HealthStatus.PANIC;
  }
}
