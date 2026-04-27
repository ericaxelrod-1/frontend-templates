import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrivacyJob, PrivacyJobStatus } from './entities/privacy-job.entity';
import { PrivacyTicket, PrivacyRequestType, PrivacyTicketStatus } from './entities/privacy-ticket.entity';
import { PrivacyRegistryService } from './privacy-registry.service';
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
  ) {
    if (!fs.existsSync(this.EXPORT_ROOT)) {
      fs.mkdirSync(this.EXPORT_ROOT, { recursive: true });
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processJobs() {
    const pendingJobs = await this.jobRepository.find({
      where: { status: PrivacyJobStatus.PENDING },
      relations: ['ticket'],
    });

    if (pendingJobs.length > 0) {
      this.logger.log(`Found ${pendingJobs.length} pending privacy jobs`);
    }

    for (const job of pendingJobs) {
      try {
        await this.handleJob(job);
      } catch (err) {
        this.logger.error(`Failed to handle job ${job.id}: ${err.message}`);
        job.status = PrivacyJobStatus.FAILED;
        job.errorLog = (job.errorLog || '') + `\nSystem Error: ${err.message}`;
        await this.jobRepository.save(job);
      }
    }
  }

  private async handleJob(job: PrivacyJob) {
    this.logger.log(`Starting privacy job ${job.id} for ticket ${job.ticketId} (Type: ${job.ticket.requestType})`);
    
    // Lock the job
    job.status = PrivacyJobStatus.PROCESSING;
    job.lockedAt = new Date();
    await this.jobRepository.save(job);

    const ticket = job.ticket;
    const providers = this.registryService.getProviders();
    const results: Record<string, any> = {};
    const errors: string[] = [];

    const promises = providers.map(async (provider) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.SERVICE_TIMEOUT_MS);

      try {
        if (ticket.requestType === PrivacyRequestType.EXPORT) {
          const stream = await provider.onExport(ticket.userId.toString());
          const fileName = `${ticket.id}_${provider.providerName}_${Date.now()}.json`;
          const filePath = path.join(this.EXPORT_ROOT, fileName);
          
          await pipeline(stream, fs.createWriteStream(filePath), { signal: controller.signal });
          results[provider.providerName] = { status: 'completed', file: fileName };
        } else if (ticket.requestType === PrivacyRequestType.ERASURE) {
          await provider.onDelete(ticket.userId.toString());
          results[provider.providerName] = { status: 'completed' };
        } else {
          results[provider.providerName] = { status: 'skipped', reason: 'Request type not handled by providers' };
        }
      } catch (err) {
        const errorMessage = err.name === 'AbortError' ? 'Timeout' : err.message;
        this.logger.error(`Provider ${provider.providerName} failed for job ${job.id}: ${errorMessage}`);
        results[provider.providerName] = { status: 'failed', error: errorMessage };
        errors.push(`${provider.providerName}: ${errorMessage}`);
      } finally {
        clearTimeout(timeout);
      }
    });

    await Promise.allSettled(promises);

    job.status = errors.length === 0 ? PrivacyJobStatus.COMPLETED : PrivacyJobStatus.FAILED;
    job.providerResults = results;
    job.errorLog = errors.join('\n');
    await this.jobRepository.save(job);

    this.logger.log(`Finished privacy job ${job.id}. Status: ${job.status}`);

    // Update ticket status if all jobs are done
    const totalJobsForTicket = await this.jobRepository.count({ where: { ticketId: job.ticketId } });
    const completedJobsForTicket = await this.jobRepository.count({ 
      where: { 
        ticketId: job.ticketId, 
        status: PrivacyJobStatus.COMPLETED 
      } 
    });
    const failedJobsForTicket = await this.jobRepository.count({ 
      where: { 
        ticketId: job.ticketId, 
        status: PrivacyJobStatus.FAILED 
      } 
    });

    if (completedJobsForTicket + failedJobsForTicket === totalJobsForTicket) {
      const finalStatus = failedJobsForTicket > 0 ? PrivacyTicketStatus.FAILED : PrivacyTicketStatus.COMPLETED;
      await this.ticketRepository.update(job.ticketId, {
        status: finalStatus,
      });
      this.logger.log(`Ticket ${job.ticketId} marked as ${finalStatus}`);
    }
  }
}
