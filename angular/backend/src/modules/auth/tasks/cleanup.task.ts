import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LoginAttemptService } from '../services/login-attempt.service';
import { IPReputationService } from '../services/ip-reputation.service';
import { CaptchaService } from '../services/captcha.service';
import { Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

// Define cleanup interval (24 hours in milliseconds)
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;

@Injectable()
export class CleanupTask {
  private readonly logger = new Logger(CleanupTask.name);

  constructor(
    private loginAttemptService: LoginAttemptService,
    private ipReputationService: IPReputationService,
    private captchaService: CaptchaService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOldLoginAttempts() {
    try {
      await this.loginAttemptService.cleanupOldAttempts(30); // Keep 30 days of history
      console.log('Successfully cleaned up old login attempts');
    } catch (error) {
      console.error('Error cleaning up old login attempts:', error);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredCaptchas() {
    try {
      await this.captchaService.cleanupExpired();
      console.log('Successfully cleaned up expired CAPTCHAs');
    } catch (error) {
      console.error('Error cleaning up expired CAPTCHAs:', error);
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async cleanupExpiredBlocks() {
    try {
      await this.ipReputationService.cleanupExpiredBlocks();
      console.log('Successfully cleaned up expired IP blocks');
    } catch (error) {
      console.error('Error cleaning up expired IP blocks:', error);
    }
  }

  @Interval(CLEANUP_INTERVAL)
  async cleanup() {
    try {
      this.logger.debug('Running scheduled cleanup task');

      // Cleanup expired login attempts
      await this.loginAttemptService.cleanupOldAttempts();

      // Cleanup expired IP reputation data
      await this.ipReputationService.cleanupExpiredBlocks();

      // Cleanup expired captchas
      await this.captchaService.cleanupExpired();

      this.logger.debug('Scheduled cleanup completed successfully');
    } catch (error) {
      this.logger.error(`Error in cleanup task: ${error.message}`, error.stack);
    }
  }
}
