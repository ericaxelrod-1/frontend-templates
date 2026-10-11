import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import { Cron, CronExpression } from '@nestjs/schedule';

export enum HealthStatus {
  NORMAL = 'NORMAL',
  WARNING = 'WARNING',   // > 90%
  CRITICAL = 'CRITICAL',  // > 95%
  PANIC = 'PANIC',     // > 98%
}

@Injectable()
export class SystemHealthService {
  private readonly logger = new Logger(SystemHealthService.name);
  private currentStatus: HealthStatus = HealthStatus.NORMAL;
  private diskUsagePercent: number = 0;

  constructor() {
    this.checkDiskSpace();
  }

  async checkDiskSpace() {
    try {
      // Use current directory to check disk space of the application partition
      const stats = await fs.statfs('.');
      
      const total = stats.bsize * stats.blocks;
      const free = stats.bsize * stats.bfree;
      const used = total - free;
      
      this.diskUsagePercent = (used / total) * 100;
      
      if (this.diskUsagePercent > 98) {
        this.currentStatus = HealthStatus.PANIC;
      } else if (this.diskUsagePercent > 95) {
        this.currentStatus = HealthStatus.CRITICAL;
      } else if (this.diskUsagePercent > 90) {
        this.currentStatus = HealthStatus.WARNING;
      } else {
        this.currentStatus = HealthStatus.NORMAL;
      }

      if (this.currentStatus !== HealthStatus.NORMAL) {
        this.logger.warn(`Disk usage is high: ${this.diskUsagePercent.toFixed(2)}% - Status: ${this.currentStatus}`);
      }
    } catch (error) {
      this.logger.error('Failed to check disk space', error.stack);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  handleCron() {
    this.checkDiskSpace();
  }

  getHealthStatus(): HealthStatus {
    return this.currentStatus;
  }

  getDiskUsage(): number {
    return this.diskUsagePercent;
  }

  isResourceCritical(): boolean {
    return this.currentStatus === HealthStatus.CRITICAL || this.currentStatus === HealthStatus.PANIC;
  }

  isPanic(): boolean {
    return this.currentStatus === HealthStatus.PANIC;
  }
}
