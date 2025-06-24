import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, Between, LessThan } from 'typeorm';
import { LoginAttempt } from '../entities/login-attempt.entity';
import { IPReputation } from '../entities/ip-reputation.entity';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';

export enum PatternType {
  BRUTE_FORCE = 'brute_force',
  DISTRIBUTED_ATTACK = 'distributed_attack',
  SUSPICIOUS_LOCATION = 'suspicious_location',
  TIME_ANOMALY = 'time_anomaly',
  RAPID_ACCOUNT_SWITCHING = 'rapid_account_switching',
  IP_HOPPING = 'ip_hopping',
}

export interface DetectedPattern {
  type: PatternType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: string;
  evidence: any;
  timestamp: Date;
  userId?: number;
  ipAddress?: string;
}

@Injectable()
export class PatternDetectionService {
  private thresholds = {
    bruteForceAttempts: 5,
    bruteForceTimeWindowMinutes: 30,
    distributedAttackMinIPs: 3,
    distributedAttackTimeWindowHours: 1,
    ipHoppingTimeWindowMinutes: 10,
    accountSwitchingThreshold: 3,
  };

  constructor(
    @InjectRepository(LoginAttempt)
    private readonly loginAttemptRepository: Repository<LoginAttempt>,
    @InjectRepository(IPReputation)
    private readonly ipReputationRepository: Repository<IPReputation>,
    private readonly configService: ConfigService,
  ) {
    // Override defaults with config values if provided
    const configThresholds = this.configService.get(
      'login.patternDetection.thresholds',
    );
    if (configThresholds) {
      this.thresholds = { ...this.thresholds, ...configThresholds };
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async detectPatterns(): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];

    // Run various pattern detection methods
    const bruteForcePatterns = await this.detectBruteForceAttempts();
    const distributedPatterns = await this.detectDistributedAttacks();
    const locationPatterns = await this.detectSuspiciousLocations();
    const timePatterns = await this.detectTimeAnomalies();
    const accountSwitchingPatterns = await this.detectRapidAccountSwitching();
    const ipHoppingPatterns = await this.detectIPHopping();

    patterns.push(
      ...bruteForcePatterns,
      ...distributedPatterns,
      ...locationPatterns,
      ...timePatterns,
      ...accountSwitchingPatterns,
      ...ipHoppingPatterns,
    );

    return patterns;
  }

  async detectBruteForceAttempts(): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];
    const startTime = new Date();
    startTime.setMinutes(
      startTime.getMinutes() - this.thresholds.bruteForceTimeWindowMinutes,
    );

    // Find IPs with multiple failed attempts in the time window
    const result = await this.loginAttemptRepository
      .createQueryBuilder('attempt')
      .select('attempt.ip_address')
      .addSelect('COUNT(*)', 'count')
      .where('attempt.status = :status', { status: 'failed' })
      .andWhere('attempt.attempted_at > :startTime', { startTime })
      .groupBy('attempt.ip_address')
      .having('COUNT(*) >= :threshold', {
        threshold: this.thresholds.bruteForceAttempts,
      })
      .getRawMany();

    for (const item of result) {
      const attempts = await this.loginAttemptRepository.find({
        where: {
          ipAddress: item.ip_address,
          status: 'failed',
          attemptedAt: MoreThan(startTime),
        },
        relations: ['user'],
        order: { attemptedAt: 'DESC' },
      });

      const uniqueEmails = [
        ...new Set(attempts.map((a) => a.emailAttempted).filter(Boolean)),
      ];

      patterns.push({
        type: PatternType.BRUTE_FORCE,
        severity: attempts.length > 10 ? 'high' : 'medium',
        details: `${attempts.length} failed login attempts from IP ${item.ip_address} in the last ${this.thresholds.bruteForceTimeWindowMinutes} minutes`,
        evidence: {
          ipAddress: item.ip_address,
          attemptCount: attempts.length,
          timeWindow: `${this.thresholds.bruteForceTimeWindowMinutes} minutes`,
          uniqueEmailCount: uniqueEmails.length,
          attempts: attempts.map((a) => ({
            timestamp: a.attemptedAt,
            email: a.emailAttempted,
            userId: a.user?.id || null,
            status: a.status,
          })),
        },
        timestamp: new Date(),
        ipAddress: item.ip_address,
      });
    }

    return patterns;
  }

  async detectDistributedAttacks(): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];
    const startTime = new Date();
    startTime.setHours(
      startTime.getHours() - this.thresholds.distributedAttackTimeWindowHours,
    );

    // Find emails with login attempts from multiple IPs
    const result = await this.loginAttemptRepository
      .createQueryBuilder('attempt')
      .select('attempt.email_attempted', 'emailAttempted')
      .addSelect('COUNT(DISTINCT attempt.ip_address)', 'ipCount')
      .where('attempt.email_attempted IS NOT NULL')
      .andWhere('attempt.attempted_at > :startTime', { startTime })
      .groupBy('attempt.email_attempted')
      .having('COUNT(DISTINCT attempt.ip_address) >= :threshold', {
        threshold: this.thresholds.distributedAttackMinIPs,
      })
      .getRawMany();

    for (const item of result) {
      const attempts = await this.loginAttemptRepository.find({
        where: {
          emailAttempted: item.emailAttempted,
          attemptedAt: MoreThan(startTime),
        },
        relations: ['user'],
        order: { attemptedAt: 'DESC' },
      });

      const uniqueIPs = [...new Set(attempts.map((a) => a.ipAddress))];

      patterns.push({
        type: PatternType.DISTRIBUTED_ATTACK,
        severity: uniqueIPs.length > 5 ? 'high' : 'medium',
        details: `Login attempts for ${item.emailAttempted} from ${uniqueIPs.length} different IP addresses in the last ${this.thresholds.distributedAttackTimeWindowHours} hours`,
        evidence: {
          email: item.emailAttempted,
          ipCount: uniqueIPs.length,
          ips: uniqueIPs,
          timeWindow: `${this.thresholds.distributedAttackTimeWindowHours} hours`,
          attempts: attempts.map((a) => ({
            timestamp: a.attemptedAt,
            ipAddress: a.ipAddress,
            status: a.status,
          })),
        },
        timestamp: new Date(),
        userId: attempts[0]?.user?.id || null,
      });
    }

    return patterns;
  }

  async detectSuspiciousLocations(): Promise<DetectedPattern[]> {
    // This would typically use IP geolocation data to detect logins from unusual locations
    // For this implementation, we'll just use mock data
    return [];
  }

  async detectTimeAnomalies(): Promise<DetectedPattern[]> {
    // Detect logins at unusual times based on user history
    // For this implementation, we'll return an empty array
    return [];
  }

  async detectRapidAccountSwitching(): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];
    const startTime = new Date();
    startTime.setHours(startTime.getHours() - 1); // Last hour

    // Find IPs that tried to log in with multiple different emails
    const result = await this.loginAttemptRepository
      .createQueryBuilder('attempt')
      .select('attempt.ip_address')
      .addSelect('COUNT(DISTINCT attempt.email_attempted)', 'emailCount')
      .where('attempt.email_attempted IS NOT NULL')
      .andWhere('attempt.attempted_at > :startTime', { startTime })
      .groupBy('attempt.ip_address')
      .having('COUNT(DISTINCT attempt.email_attempted) >= :threshold', {
        threshold: this.thresholds.accountSwitchingThreshold,
      })
      .getRawMany();

    for (const item of result) {
      const attempts = await this.loginAttemptRepository.find({
        where: {
          ipAddress: item.ip_address,
          attemptedAt: MoreThan(startTime),
        },
        relations: ['user'],
        order: { attemptedAt: 'DESC' },
      });

      const uniqueEmails = [
        ...new Set(attempts.map((a) => a.emailAttempted).filter(Boolean)),
      ];

      patterns.push({
        type: PatternType.RAPID_ACCOUNT_SWITCHING,
        severity: uniqueEmails.length > 5 ? 'high' : 'medium',
        details: `IP ${item.ip_address} attempted to log in with ${uniqueEmails.length} different email addresses in the last hour`,
        evidence: {
          ipAddress: item.ip_address,
          emailCount: uniqueEmails.length,
          emails: uniqueEmails,
          attempts: attempts.map((a) => ({
            timestamp: a.attemptedAt,
            email: a.emailAttempted,
            status: a.status,
          })),
        },
        timestamp: new Date(),
        ipAddress: item.ip_address,
      });
    }

    return patterns;
  }

  async detectIPHopping(): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];
    const startTime = new Date();
    startTime.setMinutes(
      startTime.getMinutes() - this.thresholds.ipHoppingTimeWindowMinutes,
    );

    // Find users/emails with login attempts from different IPs in a short time
    const users = await this.loginAttemptRepository
      .createQueryBuilder('attempt')
      .select('attempt.user_id', 'userId')
      .addSelect('attempt.email_attempted', 'emailAttempted')
      .where('attempt.attempted_at > :startTime', { startTime })
      .andWhere('attempt.user_id IS NOT NULL OR attempt.email_attempted IS NOT NULL')
      .groupBy('attempt.user_id, attempt.email_attempted')
      .getRawMany();

    for (const user of users) {
      let attempts;
      if (user.userId) {
        attempts = await this.loginAttemptRepository.find({
          where: {
            user: { id: user.userId },
            attemptedAt: MoreThan(startTime),
          },
          relations: ['user'],
          order: { attemptedAt: 'ASC' },
        });
      } else {
        attempts = await this.loginAttemptRepository.find({
          where: {
            emailAttempted: user.emailAttempted,
            attemptedAt: MoreThan(startTime),
          },
          relations: ['user'],
          order: { attemptedAt: 'ASC' },
        });
      }

      const uniqueIPs = [...new Set(attempts.map((a) => a.ipAddress))];

      if (uniqueIPs.length > 1) {
        // Check time between attempts from different IPs
        for (let i = 1; i < attempts.length; i++) {
          if (attempts[i].ipAddress !== attempts[i - 1].ipAddress) {
            const timeDiff =
              attempts[i].attemptedAt.getTime() -
              attempts[i - 1].attemptedAt.getTime();
            const minutesDiff = timeDiff / (1000 * 60);

            if (minutesDiff < 5) {
              // Less than 5 minutes between different IPs
              patterns.push({
                type: PatternType.IP_HOPPING,
                severity: 'high',
                details: `Rapid IP switching detected for ${user.emailAttempted || `user ID ${user.userId}`}: ${attempts[i - 1].ipAddress} to ${attempts[i].ipAddress} in ${minutesDiff.toFixed(2)} minutes`,
                evidence: {
                  userId: user.userId,
                  email: user.emailAttempted,
                  ips: uniqueIPs,
                  timeBetweenAttempts: `${minutesDiff.toFixed(2)} minutes`,
                  attempts: attempts.map((a) => ({
                    timestamp: a.attemptedAt,
                    ipAddress: a.ipAddress,
                    status: a.status,
                  })),
                },
                timestamp: new Date(),
                userId: user.userId,
                ipAddress: attempts[i].ipAddress,
              });

              // Only report the first instance for this user
              break;
            }
          }
        }
      }
    }

    return patterns;
  }
}
