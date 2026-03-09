import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThan, MoreThan } from 'typeorm';
import { LoginAttempt } from '../entities/login-attempt.entity';
import { User } from '../../users/entities/user.entity';
import { IPReputationService } from './ip-reputation.service';
import { PatternDetectionService } from './pattern-detection.service';
import { forwardRef, Inject } from '@nestjs/common';

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
    @Inject(forwardRef(() => PatternDetectionService))
    private readonly patternDetectionService: PatternDetectionService,
  ) { }

  async create(data: {
    ipAddress: string;
    userAgent: string;
    emailAttempted?: string;
    status: LoginStatus;
    user?: User;
    failureReason?: string;
    metadata?: Record<string, any>;
  }): Promise<LoginAttempt> {
    const loginAttempt = this.loginAttemptRepository.create({
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      emailAttempted: data.emailAttempted,
      status: data.status,
      user: data.user,
      failureReason: data.failureReason,
    });

    // 1. Evaluate Contextual Risk Score in real time before saving
    const riskScore = await this.patternDetectionService.evaluateRiskScore(loginAttempt);

    // Explicitly add riskScore to metadata to retain it
    const metadataWithRisk = { ...(data.metadata || {}), riskScore };
    loginAttempt.metadata = JSON.stringify(metadataWithRisk);

    await this.loginAttemptRepository.save(loginAttempt);

    // 2. Track the attempt in fast SQLite counters
    await this.patternDetectionService.trackLoginAttempt(loginAttempt);

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
        attemptedAt: MoreThan(cutoff),
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
        attemptedAt: MoreThan(cutoff),
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
        emailAttempted: email,
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

  async getRecentAttemptsForDashboard(
    limit: number = 50,
    offset: number = 0,
    filters?: {
      email?: string;
      ipAddress?: string;
      status?: string;
      dateFrom?: Date;
      dateTo?: Date;
      sortBy?: string;
      sortDirection?: 'asc' | 'desc';
    },
  ): Promise<any[]> {
    const query = this.loginAttemptRepository
      .createQueryBuilder('attempt')
      .limit(limit)
      .offset(offset);

    if (filters?.email) {
      query.andWhere('attempt.emailAttempted LIKE :email', {
        email: `%${filters.email}%`,
      });
    }

    if (filters?.ipAddress) {
      query.andWhere('attempt.ipAddress LIKE :ipAddress', {
        ipAddress: `%${filters.ipAddress}%`,
      });
    }

    if (filters?.status) {
      query.andWhere('attempt.status = :status', { status: filters.status });
    }

    if (filters?.dateFrom) {
      query.andWhere('attempt.attemptedAt >= :dateFrom', {
        dateFrom: filters.dateFrom,
      });
    }

    if (filters?.dateTo) {
      query.andWhere('attempt.attemptedAt <= :dateTo', {
        dateTo: filters.dateTo,
      });
    }

    // Handle sorting - Enhanced server-side sorting with comprehensive field mapping
    const sortBy = filters?.sortBy || 'createdAt'; // Changed default from 'attemptedAt' to 'createdAt' to match frontend
    const sortDirection = filters?.sortDirection || 'desc'; // Ensure descending is default (newest first)

    // Comprehensive mapping from frontend field names to database field names
    const fieldMapping: { [key: string]: string } = {
      id: 'attempt.id',
      createdAt: 'attempt.attemptedAt', // Frontend 'createdAt' maps to database 'attemptedAt'
      timestamp: 'attempt.attemptedAt', // Alternative name for timestamp column
      attemptedAt: 'attempt.attemptedAt', // Direct mapping for backwards compatibility
      email: 'attempt.emailAttempted',
      emailAttempted: 'attempt.emailAttempted',
      ipAddress: 'attempt.ipAddress',
      status: 'attempt.status',
      failureReason: 'attempt.failureReason',
      userAgent: 'attempt.userAgent',
    };

    // Validate sort field and use safe default
    const dbField = fieldMapping[sortBy] || 'attempt.attemptedAt';

    // Validate sort direction - ENSURE DESCENDING BY DEFAULT (newest first)
    const validDirection =
      sortDirection?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Apply ORDER BY clause - this generates SQL like: ORDER BY attempt.attemptedAt DESC
    query.orderBy(dbField, validDirection);

    const attempts = await query.getMany();

    // Transform the data to include the fields the frontend expects
    const transformed = attempts.map((attempt) => ({
      id: attempt.id,
      ipAddress: attempt.ipAddress,
      userAgent: attempt.userAgent,
      email: attempt.emailAttempted || '', // Map emailAttempted to email, handle null values
      status: attempt.status,
      failureReason: attempt.failureReason || '',
      createdAt: attempt.attemptedAt, // Map attemptedAt to createdAt
      // Include original fields as well for compatibility
      emailAttempted: attempt.emailAttempted,
      attemptedAt: attempt.attemptedAt,
    }));

    return transformed;
  }

  async getTotalAttemptsCount(filters?: {
    email?: string;
    ipAddress?: string;
    status?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<number> {
    const query = this.loginAttemptRepository.createQueryBuilder('attempt');

    if (filters?.email) {
      query.andWhere('attempt.emailAttempted LIKE :email', {
        email: `%${filters.email}%`,
      });
    }

    if (filters?.ipAddress) {
      query.andWhere('attempt.ipAddress LIKE :ipAddress', {
        ipAddress: `%${filters.ipAddress}%`,
      });
    }

    if (filters?.status) {
      query.andWhere('attempt.status = :status', { status: filters.status });
    }

    if (filters?.dateFrom) {
      query.andWhere('attempt.attemptedAt >= :dateFrom', {
        dateFrom: filters.dateFrom,
      });
    }

    if (filters?.dateTo) {
      query.andWhere('attempt.attemptedAt <= :dateTo', {
        dateTo: filters.dateTo,
      });
    }

    return query.getCount();
  }

  /**
   * Get aggregated statistics for a specific IP address with SQL GROUP BY
   */
  async getAggregatedStatsForIP(
    ipAddress: string,
    since: Date,
  ): Promise<{
    totalAttempts: number;
    successfulAttempts: number;
    failedAttempts: number;
    blockedAttempts: number;
    uniqueEmailsAttempted: number;
    firstAttempt: Date | null;
    lastAttempt: Date | null;
    emailsAttempted: string[];
  }> {
    // Get basic counts using SQL aggregation
    const stats = await this.loginAttemptRepository
      .createQueryBuilder('attempt')
      .select([
        'COUNT(*) as totalAttempts',
        'SUM(CASE WHEN attempt.status = "success" THEN 1 ELSE 0 END) as successfulAttempts',
        'SUM(CASE WHEN attempt.status = "failed" THEN 1 ELSE 0 END) as failedAttempts',
        'SUM(CASE WHEN attempt.status = "blocked" THEN 1 ELSE 0 END) as blockedAttempts',
        'COUNT(DISTINCT attempt.emailAttempted) as uniqueEmailsAttempted',
        'MIN(attempt.attemptedAt) as firstAttempt',
        'MAX(attempt.attemptedAt) as lastAttempt',
      ])
      .where('attempt.ipAddress = :ipAddress', { ipAddress })
      .andWhere('attempt.attemptedAt >= :since', { since })
      .getRawOne();

    // Get unique emails attempted (SQL DISTINCT equivalent)
    const emailsResult = await this.loginAttemptRepository
      .createQueryBuilder('attempt')
      .select('DISTINCT attempt.emailAttempted', 'email')
      .where('attempt.ipAddress = :ipAddress', { ipAddress })
      .andWhere('attempt.attemptedAt >= :since', { since })
      .andWhere('attempt.emailAttempted IS NOT NULL')
      .getRawMany();

    const emailsAttempted = emailsResult
      .map((row) => row.email)
      .filter(Boolean);

    return {
      totalAttempts: parseInt(stats.totalAttempts) || 0,
      successfulAttempts: parseInt(stats.successfulAttempts) || 0,
      failedAttempts: parseInt(stats.failedAttempts) || 0,
      blockedAttempts: parseInt(stats.blockedAttempts) || 0,
      uniqueEmailsAttempted: parseInt(stats.uniqueEmailsAttempted) || 0,
      firstAttempt: stats.firstAttempt ? new Date(stats.firstAttempt) : null,
      lastAttempt: stats.lastAttempt ? new Date(stats.lastAttempt) : null,
      emailsAttempted,
    };
  }
}
