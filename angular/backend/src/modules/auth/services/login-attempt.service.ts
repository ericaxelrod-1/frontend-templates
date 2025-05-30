import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThan } from 'typeorm';
import { LoginAttempt } from '../entities/login-attempt.entity';
import { User } from '../../users/entities/user.entity';
import { IPReputationService } from './ip-reputation.service';

// Define status types for login attempts
type LoginStatus =
  | 'success'
  | 'failed'
  | 'blocked'
  | 'captcha_required'
  | 'captcha_failed';

@Injectable()
export class LoginAttemptService {
  constructor(
    @InjectRepository(LoginAttempt)
    private readonly loginAttemptRepository: Repository<LoginAttempt>,
    private readonly ipReputationService: IPReputationService,
  ) {}

  async create(data: {
    ipAddress: string;
    userAgent: string;
    email?: string;
    status: LoginStatus;
    user?: User;
    failureReason?: string;
    metadata?: Record<string, any>;
  }): Promise<LoginAttempt> {
    const loginAttempt = this.loginAttemptRepository.create({
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      email: data.email,
      status: data.status,
      user: data.user,
      failureReason: data.failureReason,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    });

    await this.loginAttemptRepository.save(loginAttempt);

    // Update IP reputation based on login attempt
    if (data.status === 'failed') {
      await this.ipReputationService.incrementFailedAttempts(data.ipAddress);
    } else if (data.status === 'success') {
      await this.ipReputationService.reset(data.ipAddress);
    }

    return loginAttempt;
  }

  async getRecentAttempts(
    ipAddress: string,
    minutes: number = 30,
  ): Promise<LoginAttempt[]> {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    return this.loginAttemptRepository.find({
      where: {
        ipAddress,
        attemptedAt: LessThan(cutoff),
      },
      order: {
        attemptedAt: 'DESC',
      },
    });
  }

  async getRecentFailedAttempts(
    ipAddress: string,
    minutes: number = 30,
  ): Promise<LoginAttempt[]> {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    return this.loginAttemptRepository.find({
      where: {
        ipAddress,
        status: 'failed',
        attemptedAt: LessThan(cutoff),
      },
      order: {
        attemptedAt: 'DESC',
      },
    });
  }

  async getAttemptsByEmail(
    email: string,
    minutes: number = 30,
  ): Promise<LoginAttempt[]> {
    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000);
    return this.loginAttemptRepository.find({
      where: {
        email,
        attemptedAt: Between(cutoffTime, new Date()),
      },
      order: {
        attemptedAt: 'DESC',
      },
    });
  }

  async cleanupOldAttempts(days: number = 30): Promise<void> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await this.loginAttemptRepository.delete({
      attemptedAt: LessThan(cutoff),
    });
  }

  async getLoginAttemptStats(timeframe: {
    startDate: Date;
    endDate: Date;
  }): Promise<{
    total: number;
    successful: number;
    failed: number;
    blocked: number;
    captchaRequired: number;
  }> {
    const attempts = await this.loginAttemptRepository.find({
      where: {
        attemptedAt: Between(timeframe.startDate, timeframe.endDate),
      },
    });

    return {
      total: attempts.length,
      successful: attempts.filter((a) => a.status === 'success').length,
      failed: attempts.filter((a) => a.status === 'failed').length,
      blocked: attempts.filter((a) => a.status === 'blocked').length,
      captchaRequired: attempts.filter((a) => a.status === 'captcha_required')
        .length,
    };
  }
}
