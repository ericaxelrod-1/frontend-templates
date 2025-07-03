import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('ip_reputation')
export class IPReputation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'ip_address', type: 'text', unique: true })
  ipAddress: string;

  @Column({ name: 'status', type: 'text', default: 'unknown' })
  status: string;

  @Column({ name: 'reputation_score', type: 'integer', default: 100 })
  reputationScore: number;

  @Column({ name: 'geo_location_info', type: 'text', nullable: true })
  geoLocationInfo: string;

  @Column({ name: 'access_statistics', type: 'text', nullable: true })
  accessStatistics: string;

  @Column({ name: 'block_history', type: 'text', nullable: true })
  blockHistory: string;

  @Column({ name: 'failed_login_attempts', type: 'integer', default: 0 })
  failedLoginAttempts: number;

  /**
   * Getter for backward compatibility with services expecting failedAttempts
   * Returns the failedLoginAttempts value
   */
  get failedAttempts(): number {
    return this.failedLoginAttempts;
  }

  /**
   * Setter for backward compatibility with services setting failedAttempts
   * Sets the failedLoginAttempts field
   */
  set failedAttempts(value: number) {
    this.failedLoginAttempts = value;
  }

  @Column({ name: 'is_manually_blocked', type: 'boolean', default: false })
  isManuallyBlocked: boolean;

  /**
   * Getter for backward compatibility with services expecting isBlocked
   * Returns true if manually blocked or auto-blocked (has blockedUntilAuto date in future)
   */
  get isBlocked(): boolean {
    return (
      this.isManuallyBlocked ||
      (this.blockedUntilAuto && this.blockedUntilAuto > new Date())
    );
  }

  /**
   * Setter for backward compatibility with services setting isBlocked
   * Sets the isManuallyBlocked field
   */
  set isBlocked(value: boolean) {
    this.isManuallyBlocked = value;
  }

  @Column({ name: 'blocked_until_auto', type: 'datetime', nullable: true })
  blockedUntilAuto: Date;

  /**
   * Getter for backward compatibility with services expecting blockedUntil
   * Returns the blockedUntilAuto value
   */
  get blockedUntil(): Date {
    return this.blockedUntilAuto;
  }

  /**
   * Setter for backward compatibility with services setting blockedUntil
   * Sets the blockedUntilAuto field
   */
  set blockedUntil(value: Date) {
    this.blockedUntilAuto = value;
  }

  @Column({ name: 'captcha_challenge_count', type: 'integer', default: 0 })
  captchaChallengeCount: number;

  /**
   * Getter for backward compatibility with services expecting captchaRequiredCount
   * Returns the captchaChallengeCount value
   */
  get captchaRequiredCount(): number {
    return this.captchaChallengeCount;
  }

  /**
   * Setter for backward compatibility with services setting captchaRequiredCount
   * Sets the captchaChallengeCount field
   */
  set captchaRequiredCount(value: number) {
    this.captchaChallengeCount = value;
  }

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn({ name: 'first_seen_at', type: 'datetime' })
  firstSeenAt: Date;

  @UpdateDateColumn({ name: 'last_updated_at', type: 'datetime' })
  lastUpdatedAt: Date;
}
