import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PrivacyJob, PrivacyJobStatus } from './entities/privacy-job.entity';
import { PrivacyTicket, PrivacyTicketStatus } from './entities/privacy-ticket.entity';
import { PrivacyRegistryService } from './privacy-registry.service';
import { SecurityAlertService } from '../auth/services/security-alert.service';
import { pipeline } from 'stream/promises';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PrivacyHousekeepingService {
  private readonly logger = new Logger(PrivacyHousekeepingService.name);
  private readonly EXPORT_ROOT = path.join(process.cwd(), 'data/privacy/exports');
  private readonly SERVICE_TIMEOUT_MS = 30000; // 30 seconds

  constructor(
    @InjectRepository(PrivacyJob)
    private readonly jobRepository: Repository<PrivacyJob>,
    @InjectRepository(PrivacyTicket)
    private readonly ticketRepository: Repository<PrivacyTicket>,
    private readonly registryService: PrivacyRegistryService,
    @Inject(forwardRef(() => SecurityAlertService))
    private readonly securityAlertService: SecurityAlertService,
    private readonly configService: ConfigService,
  ) {
    if (!fs.existsSync(this.EXPORT_ROOT)) {
      fs.mkdirSync(this.EXPORT_ROOT, { recursive: true });
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupUnverifiedTickets(): Promise<void> {
    const windowHours = this.configService.get<number>('privacy.verificationWindowHours') || 24;
    const msInHour = 60 * 60 * 1000;
    const expirationDate = new Date(Date.now() - (windowHours * msInHour));

    try {
      const result = await this.ticketRepository.delete({
        status: PrivacyTicketStatus.UNVERIFIED,
        createdAt: LessThan(expirationDate),
      });

      if (result.affected && result.affected > 0) {
        this.logger.log(`Data Minimization: Hard-deleted ${result.affected} expired unverified privacy requests.`);
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup unverified tickets: ${error.message}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processJobs() {
    // ID 7: Chunked processing to avoid memory bloat
    const BATCH_SIZE = 50;

    while (true) {
      const pendingJobs = await this.jobRepository.find({
        where: { status: PrivacyJobStatus.PENDING },
        relations: ['ticket'],
        take: BATCH_SIZE,
      });

      if (pendingJobs.length === 0) {
        break;
      }

      this.logger.log(`Found ${pendingJobs.length} pending privacy jobs in batch`);

      for (const job of pendingJobs) {
        try {
          // ID 1: Atomic locking via UPDATE to ensure idempotency
          const result = await this.jobRepository.update(
            { id: job.id, status: PrivacyJobStatus.PENDING },
            {
              status: PrivacyJobStatus.PROCESSING,
              lockedAt: new Date(),
            },
          );

          if (result.affected === 1) {
            // Re-fetch with ticket relation for processing
            const lockedJob = await this.jobRepository.findOne({
              where: { id: job.id },
              relations: ['ticket'],
            });
            if (lockedJob) {
              await this.handleJob(lockedJob);
            }
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to handle job ${job.id}: ${errorMessage}`);
          try {
            await this.jobRepository.update(job.id, {
              status: PrivacyJobStatus.FAILED,
              errorLog: (job.errorLog || '') + `\nSystem Error: ${errorMessage}`,
            });
          } catch (updateErr) {
            this.logger.error(`Failed to update job status to FAILED for job ${job.id}. Aborting batch to prevent infinite loop.`);
            throw updateErr;
          }
        }
      }
    }
  }

  private async handleJob(job: PrivacyJob) {
    if (!job.ticket) {
      this.logger.error(`Job ${job.id} has no associated ticket`);
      job.status = PrivacyJobStatus.FAILED;
      job.errorLog = 'System Error: Job has no associated ticket relation';
      await this.jobRepository.save(job);
      return;
    }

    this.logger.log(
      `Starting privacy job ${job.id} for ticket ${job.ticketId} (Type: ${job.ticket.requestType})`,
    );

    const ticket = job.ticket;
    const providers = this.registryService.getProviders() || [];
    const results: Record<string, any> = {};
    const errors: string[] = [];

    const promises = providers.map(async (provider) => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.SERVICE_TIMEOUT_MS,
      );
      let filePath = '';

      try {
        const identifier = ticket.userId != null ? ticket.userId.toString() : `guest_${ticket.id}`;
        
        if (ticket.requestType === PrivacyRequestType.EXPORT) {
          // ID 12: Path Traversal Sanitization
          const sanitizedProviderName = provider.providerName.replace(
            /[^a-z0-9_-]/gi,
            '_',
          );
          const fileName = `${ticket.id}_${sanitizedProviderName}_${Date.now()}.json`;
          filePath = path.join(this.EXPORT_ROOT, fileName);

          let innerTimeout1: NodeJS.Timeout;
          const stream = await Promise.race([
            provider.onExport(identifier),
            new Promise<any>((_, reject) =>
              innerTimeout1 = setTimeout(
                () => reject(new Error(`Timeout after ${this.SERVICE_TIMEOUT_MS}ms`)),
                this.SERVICE_TIMEOUT_MS,
              ),
            ),
          ]).finally(() => clearTimeout(innerTimeout1));

          await pipeline(stream, fs.createWriteStream(filePath), {
            signal: controller.signal,
          });
          results[provider.providerName] = {
            status: 'completed',
            file: fileName,
          };
        } else if (ticket.requestType === PrivacyRequestType.ERASURE) {
          let innerTimeout2: NodeJS.Timeout;
          await Promise.race([
            provider.onDelete(identifier),
            new Promise<void>((_, reject) =>
              innerTimeout2 = setTimeout(
                () => reject(new Error(`Timeout after ${this.SERVICE_TIMEOUT_MS}ms`)),
                this.SERVICE_TIMEOUT_MS,
              ),
            ),
          ]).finally(() => clearTimeout(innerTimeout2));
          results[provider.providerName] = { status: 'completed' };
        } else {
          results[provider.providerName] = {
            status: 'skipped',
            reason: 'Request type not handled by providers',
          };
        }
      } catch (err) {
        if (filePath && fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
        }
        const isAbortError = err instanceof Error && err.name === 'AbortError';
        const errorMessage = isAbortError ? 'Timeout' : (err instanceof Error ? err.message : String(err));
        this.logger.error(
          `Provider ${provider.providerName} failed for job ${job.id}: ${errorMessage}`,
        );
        results[provider.providerName] = {
          status: 'failed',
          error: errorMessage,
        };
        errors.push(`${provider.providerName}: ${errorMessage}`);
      } finally {
        clearTimeout(timeout);
      }
    });

    await Promise.allSettled(promises);

    // ID 10: Erasure Failure Policy - mark as PARTIAL_SUCCESS if erasure failed for some providers
    if (errors.length > 0) {
      job.status =
        ticket.requestType === PrivacyRequestType.ERASURE
          ? PrivacyJobStatus.PARTIAL_SUCCESS
          : PrivacyJobStatus.FAILED;

      if (ticket.requestType === PrivacyRequestType.ERASURE) {
        try {
          await this.securityAlertService.createAlert({
            title: 'Partial Privacy Erasure Failure',
            message: `Privacy erasure job ${job.id} for ticket ${ticket.id} failed for some providers: ${errors.join(', ')}. Manual intervention required to ensure compliance.`,
            alertType: 'PRIVACY_FAILURE',
            severity: 'HIGH',
            status: 'open',
            user: ticket.userId ? { id: ticket.userId } as any : null,
          });
        } catch (alertErr) {
          this.logger.error(`Failed to create security alert for job ${job.id}: ${alertErr instanceof Error ? alertErr.message : String(alertErr)}`);
        }
      }
    } else {
      job.status = PrivacyJobStatus.COMPLETED;
    }

    job.providerResults = results;
    job.errorLog = errors.join('\n');
    await this.jobRepository.save(job);

    this.logger.log(`Finished privacy job ${job.id}. Status: ${job.status}`);

    // Update ticket status if all jobs are done
    const totalJobsForTicket = await this.jobRepository.count({
      where: { ticketId: job.ticketId },
    });
    const completedJobsForTicket = await this.jobRepository.count({
      where: {
        ticketId: job.ticketId,
        status: PrivacyJobStatus.COMPLETED,
      },
    });
    const partialSuccessJobsForTicket = await this.jobRepository.count({
      where: {
        ticketId: job.ticketId,
        status: PrivacyJobStatus.PARTIAL_SUCCESS,
      },
    });
    const failedJobsForTicket = await this.jobRepository.count({
      where: {
        ticketId: job.ticketId,
        status: PrivacyJobStatus.FAILED,
      },
    });

    if (
      completedJobsForTicket +
        partialSuccessJobsForTicket +
        failedJobsForTicket ===
      totalJobsForTicket
    ) {
      let finalStatus: PrivacyTicketStatus;

      if (failedJobsForTicket > 0) {
        finalStatus = PrivacyTicketStatus.FAILED;
      } else if (partialSuccessJobsForTicket > 0) {
        finalStatus = PrivacyTicketStatus.PARTIAL_SUCCESS;
      } else {
        finalStatus = PrivacyTicketStatus.COMPLETED;
      }

      await this.ticketRepository.update(job.ticketId, {
        status: finalStatus,
      });
      this.logger.log(`Ticket ${job.ticketId} marked as ${finalStatus}`);
    }
  }
}
