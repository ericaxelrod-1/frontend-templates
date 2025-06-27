import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, Between, LessThan } from 'typeorm';
import { LoginAttempt } from '../entities/login-attempt.entity';
import { IPReputation } from '../entities/ip-reputation.entity';
import { SecurityDetectedPattern } from '../entities/security-detected-pattern.entity';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';

export enum PatternType {
  BRUTE_FORCE = 'brute_force',
  DISTRIBUTED_ATTACK = 'distributed_attack',
  SUSPICIOUS_LOCATION = 'suspicious_location',
  TIME_ANOMALY = 'time_anomaly',
  RAPID_ACCOUNT_SWITCHING = 'rapid_account_switching',
  IP_HOPPING = 'ip_hopping',
  CREDENTIAL_STUFFING = 'credential_stuffing',
}

export interface DetectedPattern {
  id?: string;
  type: PatternType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: string;
  evidence: any;
  timestamp: Date;
  userId?: number;
  ipAddress?: string; // Keep for backwards compatibility
  ipAddresses: string[]; // New: Array of all affected IP addresses
  email?: string; // Keep for backwards compatibility  
  emails: string[]; // New: Array of all affected emails
  isHistorical?: boolean;
  status?: string;
  expanded?: boolean; // For frontend UI state
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
    @InjectRepository(SecurityDetectedPattern)
    private readonly securityDetectedPatternRepository: Repository<SecurityDetectedPattern>,
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

  /**
   * Enhanced pattern detection that returns both real-time and historical patterns
   */
  async detectPatternsEnhanced(): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];

    // Get real-time patterns (current active threats)
    const realTimePatterns = await this.detectRealTimePatterns();
    
    // Get historical patterns (stored in database)
    const historicalPatterns = await this.getHistoricalPatterns();

    // Combine both types
    patterns.push(...realTimePatterns, ...historicalPatterns);

    return patterns;
  }

  /**
   * Original method kept for backwards compatibility and cron job
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async detectPatterns(): Promise<DetectedPattern[]> {
    return this.detectRealTimePatterns();
  }

  /**
   * Detect real-time patterns (active threats happening now)
   */
  async detectRealTimePatterns(): Promise<DetectedPattern[]> {
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

    // Mark as real-time patterns
    patterns.forEach(pattern => {
      pattern.isHistorical = false;
    });

    return patterns;
  }

  /**
   * Get historical patterns from database with proper aggregation
   */
  async getHistoricalPatterns(limit: number = 50): Promise<DetectedPattern[]> {
    const storedPatterns = await this.securityDetectedPatternRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return storedPatterns.map(pattern => {
      const evidence = JSON.parse(pattern.evidence || '{}');
      
      // Extract IP addresses from evidence
      let ipAddresses: string[] = [];
      if (evidence.ips && Array.isArray(evidence.ips)) {
        ipAddresses = evidence.ips;
      } else if (evidence.ipAddress) {
        ipAddresses = [evidence.ipAddress];
      } else if (pattern.ipAddress) {
        ipAddresses = [pattern.ipAddress];
      }
      
      // Extract emails from evidence
      let emails: string[] = [];
      if (evidence.emails && Array.isArray(evidence.emails)) {
        emails = evidence.emails;
      } else if (evidence.email) {
        emails = [evidence.email];
      }
      
      return {
        id: pattern.id.toString(),
        type: pattern.patternType as PatternType,
        severity: pattern.severity as 'low' | 'medium' | 'high' | 'critical',
        details: `Historical pattern: ${pattern.patternType} from IP ${pattern.ipAddress}`,
        evidence,
        timestamp: pattern.detectionTimestamp,
        ipAddress: pattern.ipAddress, // Keep for backwards compatibility
        ipAddresses, // New aggregated field
        email: evidence.email, // Keep for backwards compatibility
        emails, // New aggregated field
        isHistorical: true,
        status: pattern.status,
      };
    });
  }

  /**
   * Create simulated login attempts for testing real-time pattern detection
   */
  async createTestLoginAttempts(scenarioType: 'brute_force' | 'distributed_attack' | 'credential_stuffing' | 'account_switching'): Promise<void> {
    const now = new Date();
    
    switch (scenarioType) {
      case 'brute_force':
        // Create 8 failed attempts from same IP in last 10 minutes
        for (let i = 0; i < 8; i++) {
          const attemptTime = new Date(now.getTime() - (i * 60000)); // 1 minute apart
          await this.createTestAttempt({
            ipAddress: '192.168.100.50',
            emailAttempted: `test${i % 3}@example.com`, // Rotate between 3 emails
            status: 'failed',
            attemptedAt: attemptTime,
            userAgent: 'Mozilla/5.0 (Test Browser)',
            failureReason: 'invalid_credentials',
          });
        }
        break;

      case 'distributed_attack':
        // Create attempts for same email from 4 different IPs
        const targetEmail = 'admin@example.com';
        const ips = ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4'];
        for (let i = 0; i < ips.length; i++) {
          const attemptTime = new Date(now.getTime() - (i * 300000)); // 5 minutes apart
          await this.createTestAttempt({
            ipAddress: ips[i],
            emailAttempted: targetEmail,
            status: Math.random() > 0.5 ? 'failed' : 'success',
            attemptedAt: attemptTime,
            userAgent: `Mozilla/5.0 (Test Browser ${i})`,
            failureReason: Math.random() > 0.5 ? 'invalid_credentials' : undefined,
          });
        }
        break;

      case 'credential_stuffing':
        // Create attempts with many different emails from same IP
        const stuffingIP = '172.16.0.100';
        const emails = [
          'admin@test.com', 'user@test.com', 'manager@test.com', 'support@test.com',
          'info@test.com', 'sales@test.com', 'contact@test.com', 'help@test.com',
          'service@test.com', 'team@test.com', 'office@test.com', 'staff@test.com'
        ];
        for (let i = 0; i < emails.length; i++) {
          const attemptTime = new Date(now.getTime() - (i * 30000)); // 30 seconds apart
          await this.createTestAttempt({
            ipAddress: stuffingIP,
            emailAttempted: emails[i],
            status: 'failed',
            attemptedAt: attemptTime,
            userAgent: 'curl/7.68.0',
            failureReason: 'invalid_credentials',
          });
        }
        break;

      case 'account_switching':
        // Create attempts with multiple different emails from same IP
        const switchingIP = '203.0.113.10';
        const switchEmails = ['alice@corp.com', 'bob@corp.com', 'charlie@corp.com', 'diana@corp.com'];
        for (let i = 0; i < switchEmails.length; i++) {
          const attemptTime = new Date(now.getTime() - (i * 120000)); // 2 minutes apart
          await this.createTestAttempt({
            ipAddress: switchingIP,
            emailAttempted: switchEmails[i],
            status: Math.random() > 0.3 ? 'failed' : 'success',
            attemptedAt: attemptTime,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            failureReason: Math.random() > 0.7 ? 'invalid_credentials' : undefined,
          });
        }
        break;
    }
  }

  /**
   * Helper method to create a test login attempt
   */
  private async createTestAttempt(attemptData: Partial<LoginAttempt>): Promise<LoginAttempt> {
    const attempt = this.loginAttemptRepository.create({
      ipAddress: attemptData.ipAddress,
      emailAttempted: attemptData.emailAttempted,
      status: attemptData.status,
      attemptedAt: attemptData.attemptedAt || new Date(),
      userAgent: attemptData.userAgent || 'Test User Agent',
      failureReason: attemptData.failureReason,
      metadata: JSON.stringify({ source: 'test_simulation', timestamp: new Date() }),
    });

    return this.loginAttemptRepository.save(attempt);
  }

  /**
   * Clear test data (remove attempts created in last 30 minutes with test metadata)
   */
  async clearTestData(): Promise<{ deleted: number }> {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    const result = await this.loginAttemptRepository
      .createQueryBuilder()
      .delete()
      .where('attempted_at > :startTime', { startTime: thirtyMinutesAgo })
      .andWhere('metadata LIKE :testSource', { testSource: '%test_simulation%' })
      .execute();

    return { deleted: result.affected || 0 };
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
        ipAddresses: [item.ip_address],
        emails: uniqueEmails,
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

      const uniqueIPs = [...new Set(attempts.map((a) => a.ipAddress))] as string[];

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
        ipAddresses: uniqueIPs,
        emails: [item.emailAttempted].filter(Boolean),
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
        ipAddresses: [item.ip_address],
        emails: uniqueEmails,
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

      const uniqueIPs = [...new Set(attempts.map((a) => a.ipAddress))] as string[];

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
                ipAddresses: uniqueIPs,
                emails: user.emailAttempted ? [user.emailAttempted] : [],
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
