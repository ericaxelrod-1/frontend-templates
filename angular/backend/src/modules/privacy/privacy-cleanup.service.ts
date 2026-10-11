import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { PrivacyJob, PrivacyJobStatus } from './entities/privacy-job.entity';
import * as fs from 'fs';
import * as path from 'path';

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
    
    if (!fs.existsSync(this.EXPORT_ROOT)) {
      return;
    }

    const files = fs.readdirSync(this.EXPORT_ROOT);
    const now = Date.now();
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(this.EXPORT_ROOT, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > this.FILE_EXPIRY_MS) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      } catch (err) {
        this.logger.error(`Failed to delete file ${file}: ${err.message}`);
      }
    }

    if (deletedCount > 0) {
      this.logger.log(`Deleted ${deletedCount} expired export files.`);
    }
  }
}
