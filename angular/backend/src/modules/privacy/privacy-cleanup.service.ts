import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { PrivacyJob, PrivacyJobStatus } from './entities/privacy-job.entity';
import * as fs from 'fs';
import * as path from 'path';

/** Outcome of one purge pass. Reported to the caller; never a bare "done". */
export interface ExpiredExportPurgeResult {
  scannedFiles: number;
  removedFiles: number;
  freedBytes: number;
  /** One entry per file that could not be removed. A partial purge is not a success. */
  errors: string[];
}

@Injectable()
export class PrivacyCleanupService {
  private readonly logger = new Logger(PrivacyCleanupService.name);
  private readonly EXPORT_ROOT = path.join(process.cwd(), 'data/privacy/exports');
  private readonly STALE_THRESHOLD_MS = 3600000; // 1 hour
  private readonly FILE_EXPIRY_MS = 86400000; // 24 hours

  constructor(
    @InjectRepository(PrivacyJob)
    private readonly jobRepository: Repository<PrivacyJob>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async staleJobMonitor() {
    this.logger.log('Running StaleJobMonitor...');
    
    const staleTime = new Date(Date.now() - this.STALE_THRESHOLD_MS);
    
    const staleJobs = await this.jobRepository.find({
      where: {
        status: PrivacyJobStatus.PROCESSING,
        lockedAt: LessThan(staleTime),
      },
    });

    if (staleJobs.length > 0) {
      this.logger.warn(`Found ${staleJobs.length} stale jobs. Resetting to PENDING.`);
      for (const job of staleJobs) {
        job.status = PrivacyJobStatus.PENDING;
        job.lockedAt = null;
        job.errorLog = (job.errorLog || '') + `\n[${new Date().toISOString()}] Job recovered by StaleJobMonitor.`;
        await this.jobRepository.save(job);
      }
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async tempFileCleaner() {
    this.logger.log('Running TempFileCleaner...');

    const result = await this.purgeExpiredExports();

    if (result.removedFiles > 0) {
      this.logger.log(
        `Deleted ${result.removedFiles} expired export files ` +
          `(${result.freedBytes} bytes freed).`,
      );
    }
    for (const error of result.errors) {
      this.logger.error(error);
    }
  }

  /**
   * Delete finished export files that are past their retention window.
   *
   * This is the *only* deletion path for exports: the nightly cron and the
   * on-demand `POST admin/system-health/clear-temp` both call this one method,
   * so an operator-triggered purge cannot drift from the scheduled one.
   *
   * It is safe to invoke at any time because it applies the same retention rule
   * the cron does — it never removes a file inside the 24h window, so it cannot
   * break an export still being written or a download link that has not expired.
   * It is useful out of band because the cron only runs at midnight, which is no
   * help to an operator at 03:00 with a full disk.
   */
  async purgeExpiredExports(): Promise<ExpiredExportPurgeResult> {
    const result: ExpiredExportPurgeResult = {
      scannedFiles: 0,
      removedFiles: 0,
      freedBytes: 0,
      errors: [],
    };

    if (!fs.existsSync(this.EXPORT_ROOT)) {
      return result;
    }

    const files = fs.readdirSync(this.EXPORT_ROOT);
    const now = Date.now();

    for (const file of files) {
      const filePath = path.join(this.EXPORT_ROOT, file);
      result.scannedFiles += 1;

      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > this.FILE_EXPIRY_MS) {
          fs.unlinkSync(filePath);
          result.removedFiles += 1;
          result.freedBytes += stats.size;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`Failed to delete file ${file}: ${message}`);
      }
    }

    return result;
  }
}
