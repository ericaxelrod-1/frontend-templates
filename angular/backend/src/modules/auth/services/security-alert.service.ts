import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SecurityAlert } from '../entities/security-alert.entity';
import { SecurityDetectedPattern } from '../entities/security-detected-pattern.entity';
import { PatternLoginAttempt } from '../entities/pattern-login-attempt.entity';

export interface AlertFilters {
  status?: string;
  severity?: string;
  alertType?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  search?: string;
}

@Injectable()
export class SecurityAlertService {
  private readonly logger = new Logger(SecurityAlertService.name);

  constructor(
    @InjectRepository(SecurityAlert)
    private readonly securityAlertRepository: Repository<SecurityAlert>,
    @InjectRepository(SecurityDetectedPattern)
    private readonly securityDetectedPatternRepository: Repository<SecurityDetectedPattern>,
    @InjectRepository(PatternLoginAttempt)
    private readonly patternLoginAttemptRepository: Repository<PatternLoginAttempt>,
  ) {}

  /**
   * Get all security alerts with optional filtering and sorting
   */
  async getSecurityAlerts(
    limit: number = 50,
    offset: number = 0,
    filters: AlertFilters = {}
  ): Promise<{ items: SecurityAlert[]; total: number }> {
    const query = this.securityAlertRepository.createQueryBuilder('alert')
      .leftJoinAndSelect('alert.pattern', 'pattern')
      .leftJoinAndSelect('alert.user', 'user')
      .leftJoinAndSelect('alert.acknowledgedBy', 'acknowledgedBy')
      .leftJoinAndSelect('alert.resolvedBy', 'resolvedBy');

    // Apply filters
    if (filters.status) {
      query.andWhere('alert.status = :status', { status: filters.status });
    }

    if (filters.severity) {
      query.andWhere('alert.severity = :severity', { severity: filters.severity });
    }

    if (filters.alertType) {
      query.andWhere('alert.alertType = :alertType', { alertType: filters.alertType });
    }

    if (filters.dateFrom) {
      query.andWhere('alert.createdAt >= :dateFrom', { dateFrom: filters.dateFrom });
    }

    if (filters.dateTo) {
      query.andWhere('alert.createdAt <= :dateTo', { dateTo: filters.dateTo });
    }

    // Apply search filter
    if (filters.search) {
      query.andWhere(
        '(alert.title LIKE :search OR alert.message LIKE :search OR alert.alertType LIKE :search)',
        { search: `%${filters.search}%` }
      );
    }

    // Apply sorting
    const sortBy = filters.sortBy || 'createdAt';
    const sortDirection = filters.sortDirection || 'desc';
    query.orderBy(`alert.${sortBy}`, sortDirection.toUpperCase() as 'ASC' | 'DESC');

    // Get total count
    const total = await query.getCount();

    // Apply pagination
    query.skip(offset).take(limit);

    const items = await query.getMany();

    return { items, total };
  }

  /**
   * Get security alert by ID
   */
  async getSecurityAlertById(id: number): Promise<SecurityAlert | null> {
    return this.securityAlertRepository.findOne({
      where: { id },
      relations: ['pattern', 'user', 'acknowledgedBy', 'resolvedBy'],
    });
  }

  /**
   * Acknowledge a security alert
   */
  async acknowledgeAlert(alertId: number, userId: number): Promise<SecurityAlert> {
    const alert = await this.getSecurityAlertById(alertId);
    if (!alert) {
      throw new Error(`Alert with ID ${alertId} not found`);
    }

    alert.status = 'acknowledged';
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = { id: userId } as any; // TypeORM will handle the relation

    await this.securityAlertRepository.save(alert);
    
    this.logger.log(`Alert ${alertId} acknowledged by user ${userId}`);
    return this.getSecurityAlertById(alertId);
  }

  /**
   * Resolve a security alert
   */
  async resolveAlert(alertId: number, userId: number, notes?: string): Promise<SecurityAlert> {
    const alert = await this.getSecurityAlertById(alertId);
    if (!alert) {
      throw new Error(`Alert with ID ${alertId} not found`);
    }

    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    alert.resolvedBy = { id: userId } as any; // TypeORM will handle the relation
    if (notes) {
      alert.resolutionNotes = notes;
    }

    await this.securityAlertRepository.save(alert);
    
    this.logger.log(`Alert ${alertId} resolved by user ${userId}`);
    return this.getSecurityAlertById(alertId);
  }

  /**
   * Dismiss a security alert
   */
  async dismissAlert(alertId: number, userId: number): Promise<SecurityAlert> {
    const alert = await this.getSecurityAlertById(alertId);
    if (!alert) {
      throw new Error(`Alert with ID ${alertId} not found`);
    }

    alert.status = 'dismissed';
    alert.resolvedAt = new Date();
    alert.resolvedBy = { id: userId } as any; // TypeORM will handle the relation

    await this.securityAlertRepository.save(alert);
    
    this.logger.log(`Alert ${alertId} dismissed by user ${userId}`);
    return this.getSecurityAlertById(alertId);
  }

  /**
   * Create a new security alert
   */
  async createAlert(alertData: Partial<SecurityAlert>): Promise<SecurityAlert> {
    const alert = this.securityAlertRepository.create(alertData);
    const savedAlert = await this.securityAlertRepository.save(alert);
    
    this.logger.log(`New security alert created: ${savedAlert.title}`);
    return this.getSecurityAlertById(savedAlert.id);
  }

  /**
   * Get security patterns with optional filtering
   */
  async getSecurityPatterns(
    limit: number = 50,
    offset: number = 0,
    filters: any = {}
  ): Promise<{ items: SecurityDetectedPattern[]; total: number }> {
    const query = this.securityDetectedPatternRepository.createQueryBuilder('pattern')
      .leftJoinAndSelect('pattern.resolvedBy', 'resolvedBy')
      .leftJoinAndSelect('pattern.alerts', 'alerts');

    // Apply filters
    if (filters.status) {
      query.andWhere('pattern.status = :status', { status: filters.status });
    }

    if (filters.patternType) {
      query.andWhere('pattern.patternType = :patternType', { patternType: filters.patternType });
    }

    if (filters.severity) {
      query.andWhere('pattern.severity = :severity', { severity: filters.severity });
    }

    if (filters.ipAddress) {
      query.andWhere('pattern.ipAddress = :ipAddress', { ipAddress: filters.ipAddress });
    }

    // Apply sorting
    const sortBy = filters.sortBy || 'detectionTimestamp';
    const sortDirection = filters.sortDirection || 'desc';
    query.orderBy(`pattern.${sortBy}`, sortDirection.toUpperCase() as 'ASC' | 'DESC');

    // Get total count
    const total = await query.getCount();

    // Apply pagination
    query.skip(offset).take(limit);

    const items = await query.getMany();

    return { items, total };
  }

  /**
   * Get pattern evidence (login attempts associated with a pattern)
   */
  async getPatternEvidence(patternId: number): Promise<any[]> {
    const patternAttempts = await this.patternLoginAttemptRepository.find({
      where: { pattern: { id: patternId } },
      relations: ['loginAttempt'],
    });

    return patternAttempts.map(pa => ({
      ...pa.loginAttempt,
      isPrimaryEvidence: pa.isPrimaryEvidence,
    }));
  }
}
