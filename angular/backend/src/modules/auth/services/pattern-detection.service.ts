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
   * UNIFIED PATTERN DETECTION: Detect patterns and automatically store them in database
   * This method replaces the dual data source approach with a single unified approach
   * FIXED: Race condition by using immediate storage and better duplicate handling
   */
  async detectAndStorePatterns(): Promise<DetectedPattern[]> {
    // Detect real-time patterns
    const realTimePatterns = await this.detectRealTimePatterns();

    // Store any new patterns to database with improved duplicate handling
    const storedPatterns: DetectedPattern[] = [];
    for (const pattern of realTimePatterns) {
      const stored = await this.storePatternWithGrouping(pattern);
      if (stored) {
        storedPatterns.push(this.transformStoredPatternToDetectedPattern(stored));
      }
    }

    // Return all patterns from database (includes both new and existing)
    return this.getStoredPatterns();
  }

  /**
   * UNIFIED PATTERN RETRIEVAL: Get all patterns from single data source with optional filtering
   * This method serves as the single source of truth for all pattern queries
   */
  async getPatterns(
    limit: number = 50,
    offset: number = 0,
    filters: any = {},
  ): Promise<{ items: DetectedPattern[]; total: number }> {
    // First ensure we have the latest patterns stored
    await this.detectAndStorePatterns();

    // Then retrieve with filtering
    const query = this.securityDetectedPatternRepository
      .createQueryBuilder('pattern')
      .leftJoinAndSelect('pattern.resolvedBy', 'resolvedBy')
      .leftJoinAndSelect('pattern.alerts', 'alerts');

    // Apply filters
    if (filters.status) {
      query.andWhere('pattern.status = :status', { status: filters.status });
    }

    if (filters.patternType) {
      query.andWhere('pattern.patternType = :patternType', {
        patternType: filters.patternType,
      });
    }

    if (filters.severity) {
      query.andWhere('pattern.severity = :severity', {
        severity: filters.severity,
      });
    }

    if (filters.ipAddress) {
      query.andWhere('pattern.ipAddress = :ipAddress', {
        ipAddress: filters.ipAddress,
      });
    }

    if (filters.dateFrom) {
      query.andWhere('pattern.detectionTimestamp >= :dateFrom', {
        dateFrom: filters.dateFrom,
      });
    }

    if (filters.dateTo) {
      query.andWhere('pattern.detectionTimestamp <= :dateTo', {
        dateTo: filters.dateTo,
      });
    }

    // Apply search filter
    if (filters.search) {
      query.andWhere(
        '(pattern.patternType LIKE :search OR pattern.ipAddress LIKE :search OR pattern.evidence LIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    // Apply sorting
    const sortBy = filters.sortBy || 'detectionTimestamp';
    const sortDirection = filters.sortDirection || 'desc';
    query.orderBy(
      `pattern.${sortBy}`,
      sortDirection.toUpperCase() as 'ASC' | 'DESC',
    );

    // Get total count
    const total = await query.getCount();

    // Apply pagination
    query.skip(offset).take(limit);

    const items = await query.getMany();

    // Transform to DetectedPattern format
    const patterns = items.map((pattern) =>
      this.transformStoredPatternToDetectedPattern(pattern),
    );

    return { items: patterns, total };
  }

  /**
   * Store a detected pattern with improved duplicate handling and grouping logic
   * FIXED: Race condition by using time-window based grouping instead of exact timestamp matching
   */
  private async storePatternWithGrouping(
    pattern: DetectedPattern,
  ): Promise<SecurityDetectedPattern | null> {
    try {
      const detectionTime = new Date(pattern.timestamp);
      const timeWindow = this.calculateTimeWindow(pattern.type);
      const windowStart = new Date(detectionTime.getTime() - timeWindow.lookback);
      const windowEnd = new Date(detectionTime.getTime() + timeWindow.lookahead);

      // Look for existing patterns of the same type and IP within a reasonable time window (5 minutes)
      // This prevents exact duplicates while allowing legitimate new patterns
      const fiveMinutesAgo = new Date(detectionTime.getTime() - 5 * 60 * 1000);
      const existingPattern = await this.securityDetectedPatternRepository.findOne({
        where: {
          patternType: pattern.type,
          ipAddress: pattern.ipAddress || pattern.ipAddresses?.[0] || 'unknown',
          detectionTimestamp: MoreThan(fiveMinutesAgo),
          status: 'active'
        },
        order: { detectionTimestamp: 'DESC' }
      });

      if (existingPattern) {
        // Update existing pattern with new evidence and increment group count
        const existingEvidence = JSON.parse(existingPattern.evidence || '{}');
        const newEvidence = {
          ...existingEvidence,
          ...pattern.evidence,
          groupedPatternCount: (existingEvidence.groupedPatternCount || 1) + 1,
          lastDetection: detectionTime,
          detectionHistory: [
            ...(existingEvidence.detectionHistory || []),
            {
              timestamp: detectionTime,
              attemptCount: pattern.evidence?.attemptCount || 0,
              source: pattern.evidence?.source || 'real-time'
            }
          ]
        };

        existingPattern.evidence = JSON.stringify(newEvidence);
        existingPattern.attemptCount = Math.max(existingPattern.attemptCount, pattern.evidence?.attemptCount || 0);
        existingPattern.uniqueEmailCount = Math.max(existingPattern.uniqueEmailCount, pattern.evidence?.uniqueEmailCount || pattern.emails?.length || 0);
        
        return await this.securityDetectedPatternRepository.save(existingPattern);
      }

      // Create new pattern with grouping metadata
      const storedPattern = this.securityDetectedPatternRepository.create({
        patternType: pattern.type,
        severity: pattern.severity,
        ipAddress: pattern.ipAddress || pattern.ipAddresses?.[0] || 'unknown',
        detectionTimestamp: detectionTime,
        timeWindowStart: windowStart,
        timeWindowEnd: windowEnd,
        evidence: JSON.stringify({
          ...pattern.evidence,
          groupedPatternCount: 1,
          firstDetection: detectionTime,
          lastDetection: detectionTime,
          detectionHistory: [{
            timestamp: detectionTime,
            attemptCount: pattern.evidence?.attemptCount || 0,
            source: pattern.evidence?.source || 'real-time'
          }]
        }),
        status: 'active',
        attemptCount: pattern.evidence?.attemptCount || 0,
        uniqueEmailCount: pattern.evidence?.uniqueEmailCount || pattern.emails?.length || 0,
      });

      const savedPattern = await this.securityDetectedPatternRepository.save(storedPattern);
      console.log(
        `Stored new pattern: ${pattern.type} from IP ${pattern.ipAddress || pattern.ipAddresses?.[0]} (${windowStart.toISOString()} - ${windowEnd.toISOString()})`
      );

      return savedPattern;
    } catch (error) {
      console.error(`Failed to store pattern ${pattern.type}:`, error);
      // Don't throw error, just log it and continue
      return null;
    }
  }

  /**
   * Calculate time window for pattern based on pattern type
   */
  private calculateTimeWindow(patternType: PatternType): { lookback: number; lookahead: number } {
    const timeWindows = {
      [PatternType.BRUTE_FORCE]: { lookback: 30 * 60 * 1000, lookahead: 10 * 60 * 1000 }, // 30min back, 10min ahead
      [PatternType.DISTRIBUTED_ATTACK]: { lookback: 60 * 60 * 1000, lookahead: 15 * 60 * 1000 }, // 1hr back, 15min ahead
      [PatternType.CREDENTIAL_STUFFING]: { lookback: 60 * 60 * 1000, lookahead: 15 * 60 * 1000 }, // 1hr back, 15min ahead
      [PatternType.RAPID_ACCOUNT_SWITCHING]: { lookback: 15 * 60 * 1000, lookahead: 5 * 60 * 1000 }, // 15min back, 5min ahead
      [PatternType.IP_HOPPING]: { lookback: 10 * 60 * 1000, lookahead: 5 * 60 * 1000 }, // 10min back, 5min ahead
      [PatternType.SUSPICIOUS_LOCATION]: { lookback: 24 * 60 * 60 * 1000, lookahead: 60 * 60 * 1000 }, // 24hr back, 1hr ahead
      [PatternType.TIME_ANOMALY]: { lookback: 60 * 60 * 1000, lookahead: 30 * 60 * 1000 }, // 1hr back, 30min ahead
    };

    return timeWindows[patternType] || { lookback: 30 * 60 * 1000, lookahead: 10 * 60 * 1000 };
  }

  /**
   * Get stored patterns from database (used internally)
   */
  private async getStoredPatterns(
    limit: number = 50,
  ): Promise<DetectedPattern[]> {
    const storedPatterns = await this.securityDetectedPatternRepository.find({
      order: { detectionTimestamp: 'DESC' },
      take: limit,
    });

    return storedPatterns.map((pattern) =>
      this.transformStoredPatternToDetectedPattern(pattern),
    );
  }

  /**
   * Transform stored pattern entity to DetectedPattern interface
   * ENHANCED: Include grouping information for display
   */
  private transformStoredPatternToDetectedPattern(
    pattern: SecurityDetectedPattern,
  ): DetectedPattern {
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

    // Create enhanced details with grouping information
    const groupCount = evidence.groupedPatternCount || 1;
    const baseDetails = `Pattern: ${pattern.patternType} from IP ${pattern.ipAddress}`;
    const groupDetails = groupCount > 1 ? ` (${groupCount} similar patterns grouped)` : '';

    return {
      id: pattern.id.toString(),
      type: pattern.patternType as PatternType,
      severity: pattern.severity as 'low' | 'medium' | 'high' | 'critical',
      details: baseDetails + groupDetails,
      evidence: {
        ...evidence,
        groupedPatternCount: groupCount,
        displayCount: groupCount // For frontend display
      },
      timestamp: pattern.detectionTimestamp,
      ipAddress: pattern.ipAddress, // Keep for backwards compatibility
      ipAddresses, // New aggregated field
      email: evidence.email, // Keep for backwards compatibility
      emails, // New aggregated field
      isHistorical: true, // All stored patterns are considered historical
      status: pattern.status,
    };
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
    patterns.forEach((pattern) => {
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

    return storedPatterns.map((pattern) => {
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
  async createTestLoginAttempts(
    scenarioType:
      | 'brute_force'
      | 'distributed_attack'
      | 'credential_stuffing'
      | 'account_switching'
      | 'ip_hopping'
      | 'suspicious_location'
      | 'time_anomaly',
  ): Promise<void> {
    const now = new Date();

    switch (scenarioType) {
      case 'brute_force':
        // Create 8 failed attempts from same IP in last 10 minutes
        for (let i = 0; i < 8; i++) {
          const attemptTime = new Date(now.getTime() - i * 60000); // 1 minute apart
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
          const attemptTime = new Date(now.getTime() - i * 300000); // 5 minutes apart
          await this.createTestAttempt({
            ipAddress: ips[i],
            emailAttempted: targetEmail,
            status: Math.random() > 0.5 ? 'failed' : 'success',
            attemptedAt: attemptTime,
            userAgent: `Mozilla/5.0 (Test Browser ${i})`,
            failureReason:
              Math.random() > 0.5 ? 'invalid_credentials' : undefined,
          });
        }
        break;

      case 'credential_stuffing':
        // Create attempts with many different emails from same IP
        const stuffingIP = '172.16.0.100';
        const emails = [
          'admin@test.com',
          'user@test.com',
          'manager@test.com',
          'support@test.com',
          'info@test.com',
          'sales@test.com',
          'contact@test.com',
          'help@test.com',
          'service@test.com',
          'team@test.com',
          'office@test.com',
          'staff@test.com',
        ];
        for (let i = 0; i < emails.length; i++) {
          const attemptTime = new Date(now.getTime() - i * 30000); // 30 seconds apart
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
        const switchEmails = [
          'alice@corp.com',
          'bob@corp.com',
          'charlie@corp.com',
          'diana@corp.com',
        ];
        for (let i = 0; i < switchEmails.length; i++) {
          const attemptTime = new Date(now.getTime() - i * 120000); // 2 minutes apart
          await this.createTestAttempt({
            ipAddress: switchingIP,
            emailAttempted: switchEmails[i],
            status: Math.random() > 0.3 ? 'failed' : 'success',
            attemptedAt: attemptTime,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            failureReason:
              Math.random() > 0.7 ? 'invalid_credentials' : undefined,
          });
        }
        break;

      case 'ip_hopping':
        // Create attempts from rapidly changing IP addresses for same user
        const hoppingEmail = 'target@example.com';
        const hoppingIPs = [
          '10.1.1.1', '10.1.1.2', '10.1.1.3', '10.1.1.4', '10.1.1.5',
          '10.1.1.6', '10.1.1.7', '10.1.1.8', '10.1.1.9', '10.1.1.10'
        ];
        for (let i = 0; i < hoppingIPs.length; i++) {
          const attemptTime = new Date(now.getTime() - i * 60000); // 1 minute apart
          await this.createTestAttempt({
            ipAddress: hoppingIPs[i],
            emailAttempted: hoppingEmail,
            status: Math.random() > 0.6 ? 'failed' : 'success',
            attemptedAt: attemptTime,
            userAgent: `Mozilla/5.0 (IP Hopping Test ${i})`,
            failureReason: Math.random() > 0.6 ? 'invalid_credentials' : undefined,
          });
        }
        break;

      case 'suspicious_location':
        // Create attempts from geographically suspicious locations
        const suspiciousEmails = ['user1@company.com', 'user2@company.com'];
        const suspiciousIPs = [
          '1.2.3.4',    // Suspicious foreign IP
          '45.67.89.12', // Another suspicious IP
          '123.45.67.89', // VPN/Proxy IP range
          '200.100.50.25' // High-risk country IP
        ];
        for (let i = 0; i < suspiciousIPs.length; i++) {
          const attemptTime = new Date(now.getTime() - i * 180000); // 3 minutes apart
          await this.createTestAttempt({
            ipAddress: suspiciousIPs[i],
            emailAttempted: suspiciousEmails[i % suspiciousEmails.length],
            status: Math.random() > 0.4 ? 'failed' : 'success',
            attemptedAt: attemptTime,
            userAgent: 'Mozilla/5.0 (Suspicious Location Test)',
            failureReason: Math.random() > 0.4 ? 'invalid_credentials' : undefined,
          });
        }
        break;

      case 'time_anomaly':
        // Create login attempts at unusual hours (2-4 AM)
        const anomalyEmail = 'nightshift@example.com';
        const anomalyIP = '192.168.1.100';
        const baseTime = new Date();
        baseTime.setHours(3, 0, 0, 0); // 3 AM today
        
        for (let i = 0; i < 6; i++) {
          const attemptTime = new Date(baseTime.getTime() - i * 86400000); // 1 day apart, all at 3 AM
          await this.createTestAttempt({
            ipAddress: anomalyIP,
            emailAttempted: anomalyEmail,
            status: Math.random() > 0.3 ? 'success' : 'failed',
            attemptedAt: attemptTime,
            userAgent: 'Mozilla/5.0 (Time Anomaly Test)',
            failureReason: Math.random() > 0.7 ? 'invalid_credentials' : undefined,
          });
        }
        break;
    }
  }

  /**
   * Helper method to create a test login attempt
   */
  private async createTestAttempt(
    attemptData: Partial<LoginAttempt>,
  ): Promise<LoginAttempt> {
    const attempt = this.loginAttemptRepository.create({
      ipAddress: attemptData.ipAddress,
      emailAttempted: attemptData.emailAttempted,
      status: attemptData.status,
      attemptedAt: attemptData.attemptedAt || new Date(),
      userAgent: attemptData.userAgent || 'Test User Agent',
      failureReason: attemptData.failureReason,
      metadata: JSON.stringify({
        source: 'test_simulation',
        timestamp: new Date(),
      }),
    });

    return this.loginAttemptRepository.save(attempt);
  }

  /**
   * Clear test data (remove all attempts with test metadata - NO TIME LIMIT)
   */
  async clearTestData(): Promise<{ deleted: number; patternsDeleted: number }> {
    // Delete all test login attempts (no time limit)
    const loginAttemptsResult = await this.loginAttemptRepository
      .createQueryBuilder()
      .delete()
      .where('metadata LIKE :testSource', {
        testSource: '%test_simulation%',
      })
      .execute();

    // Also delete all test-related patterns to prevent confusion
    const patternsResult = await this.securityDetectedPatternRepository
      .createQueryBuilder()
      .delete()
      .where('evidence LIKE :testSource', {
        testSource: '%test_simulation%',
      })
      .execute();

    return { 
      deleted: loginAttemptsResult.affected || 0,
      patternsDeleted: patternsResult.affected || 0
    };
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
      .select('attempt.ipAddress')
      .addSelect('COUNT(*)', 'count')
      .where('attempt.status = :status', { status: 'failed' })
      .andWhere('attempt.attemptedAt > :startTime', { startTime })
      .groupBy('attempt.ipAddress')
      .having('COUNT(*) >= :threshold', {
        threshold: this.thresholds.bruteForceAttempts,
      })
      .getRawMany();

    for (const item of result) {
      const attempts = await this.loginAttemptRepository.find({
        where: {
          ipAddress: item.attempt_ipAddress,
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
        details: `${attempts.length} failed login attempts from IP ${item.attempt_ipAddress} in the last ${this.thresholds.bruteForceTimeWindowMinutes} minutes`,
        evidence: {
          ipAddress: item.attempt_ipAddress,
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
        ipAddress: item.attempt_ipAddress,
        ipAddresses: [item.attempt_ipAddress],
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
      .select('attempt.emailAttempted', 'emailAttempted')
      .addSelect('COUNT(DISTINCT attempt.ipAddress)', 'ipCount')
      .where('attempt.emailAttempted IS NOT NULL')
      .andWhere('attempt.attemptedAt > :startTime', { startTime })
      .groupBy('attempt.emailAttempted')
      .having('COUNT(DISTINCT attempt.ipAddress) >= :threshold', {
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

      const uniqueIPs = [
        ...new Set(attempts.map((a) => a.ipAddress)),
      ] as string[];

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
      .select('attempt.ipAddress')
      .addSelect('COUNT(DISTINCT attempt.emailAttempted)', 'emailCount')
      .where('attempt.emailAttempted IS NOT NULL')
      .andWhere('attempt.attemptedAt > :startTime', { startTime })
      .groupBy('attempt.ipAddress')
      .having('COUNT(DISTINCT attempt.emailAttempted) >= :threshold', {
        threshold: this.thresholds.accountSwitchingThreshold,
      })
      .getRawMany();

    for (const item of result) {
      const attempts = await this.loginAttemptRepository.find({
        where: {
          ipAddress: item.attempt_ipAddress,
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
        details: `IP ${item.attempt_ipAddress} attempted to log in with ${uniqueEmails.length} different email addresses in the last hour`,
        evidence: {
          ipAddress: item.attempt_ipAddress,
          emailCount: uniqueEmails.length,
          emails: uniqueEmails,
          attempts: attempts.map((a) => ({
            timestamp: a.attemptedAt,
            email: a.emailAttempted,
            status: a.status,
          })),
        },
        timestamp: new Date(),
        ipAddress: item.attempt_ipAddress,
        ipAddresses: [item.attempt_ipAddress],
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
    // Use entity property names in TypeORM query builder, not database column names
    const users = await this.loginAttemptRepository
      .createQueryBuilder('attempt')
      .leftJoin('attempt.user', 'user')
      .select('user.id', 'userId')
      .addSelect('attempt.emailAttempted', 'emailAttempted')
      .where('attempt.attemptedAt > :startTime', { startTime })
      .andWhere('user.id IS NOT NULL OR attempt.emailAttempted IS NOT NULL')
      .groupBy('user.id, attempt.emailAttempted')
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

      const uniqueIPs = [
        ...new Set(attempts.map((a) => a.ipAddress)),
      ] as string[];

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

  /**
   * Get pattern summary for dashboard tiles
   * Returns aggregated pattern counts by type with severity distribution
   */
  async getPatternSummary(
    dateFrom?: Date,
    dateTo?: Date,
    timeRange?: '24h' | '7d' | '30d' | '90d' | 'all',
  ): Promise<{
    patternType: string;
    displayName: string;
    count: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    lastDetected: Date;
    percentage?: number;
  }[]> {
    // Calculate time range if predefined range is provided
    let startDate: Date | undefined = dateFrom;
    let endDate: Date | undefined = dateTo;

    if (timeRange && timeRange !== 'all') {
      endDate = new Date();
      startDate = new Date();
      
      switch (timeRange) {
        case '24h':
          startDate.setHours(startDate.getHours() - 24);
          break;
        case '7d':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(startDate.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(startDate.getDate() - 90);
          break;
      }
    }

    // Build query for pattern aggregation
    const query = this.securityDetectedPatternRepository
      .createQueryBuilder('pattern')
      .select('pattern.patternType', 'patternType')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MAX(pattern.detectionTimestamp)', 'lastDetected')
      .addSelect('pattern.severity', 'severity')
      .addSelect('COUNT(CASE WHEN pattern.severity = \'critical\' THEN 1 END)', 'criticalCount')
      .addSelect('COUNT(CASE WHEN pattern.severity = \'high\' THEN 1 END)', 'highCount')
      .addSelect('COUNT(CASE WHEN pattern.severity = \'medium\' THEN 1 END)', 'mediumCount')
      .addSelect('COUNT(CASE WHEN pattern.severity = \'low\' THEN 1 END)', 'lowCount');

    // Apply time filters
    if (startDate) {
      query.andWhere('pattern.detectionTimestamp >= :startDate', { startDate });
    }
    if (endDate) {
      query.andWhere('pattern.detectionTimestamp <= :endDate', { endDate });
    }

    // Group by pattern type
    query.groupBy('pattern.patternType');

    const results = await query.getRawMany();

    // Calculate total count for percentages
    const totalCount = results.reduce((sum, item) => sum + parseInt(item.count), 0);

    // Pattern type display names mapping
    const displayNames = {
      'brute_force': 'Brute Force Attacks',
      'distributed_attack': 'Distributed Attacks',
      'credential_stuffing': 'Credential Stuffing',
      'rapid_account_switching': 'Account Switching',
      'ip_hopping': 'IP Hopping',
      'suspicious_location': 'Suspicious Locations',
      'time_anomaly': 'Time Anomalies',
    };

    // Process results and determine predominant severity
    const summaries = results.map(item => {
      const count = parseInt(item.count);
      const criticalCount = parseInt(item.criticalCount) || 0;
      const highCount = parseInt(item.highCount) || 0;
      const mediumCount = parseInt(item.mediumCount) || 0;
      const lowCount = parseInt(item.lowCount) || 0;

      // Determine predominant severity
      let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
      if (criticalCount > 0) {
        severity = 'critical';
      } else if (highCount > 0) {
        severity = 'high';
      } else if (mediumCount > 0) {
        severity = 'medium';
      }

      return {
        patternType: item.patternType,
        displayName: displayNames[item.patternType] || item.patternType,
        count,
        severity,
        lastDetected: new Date(item.lastDetected),
        percentage: totalCount > 0 ? Math.round((count / totalCount) * 100) : 0,
      };
    });

    // Ensure all pattern types are represented, even with 0 count
    const allPatternTypes = Object.keys(displayNames);
    const existingTypes = summaries.map(s => s.patternType);
    
    for (const patternType of allPatternTypes) {
      if (!existingTypes.includes(patternType)) {
        summaries.push({
          patternType,
          displayName: displayNames[patternType],
          count: 0,
          severity: 'low',
          lastDetected: new Date(0), // Epoch time for never detected
          percentage: 0,
        });
      }
    }

    // Sort by count descending, then by severity
    return summaries.sort((a, b) => {
      if (a.count !== b.count) {
        return b.count - a.count;
      }
      const severityOrder = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
  }
}
