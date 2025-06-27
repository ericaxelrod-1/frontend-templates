import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { SecurityAlert } from './security-alert.entity';
import { PatternLoginAttempt } from './pattern-login-attempt.entity';

@Entity('security_detected_patterns')
export class SecurityDetectedPattern {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'pattern_type', length: 50 })
  patternType: string;

  @Column({ length: 20, default: 'medium' })
  severity: string;

  @Column({ name: 'ip_address', type: 'text' })
  ipAddress: string;

  @Column({ name: 'detection_timestamp', type: 'datetime', default: () => 'datetime(\'now\')' })
  detectionTimestamp: Date;

  @Column({ name: 'time_window_start', type: 'datetime' })
  timeWindowStart: Date;

  @Column({ name: 'time_window_end', type: 'datetime' })
  timeWindowEnd: Date;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount: number;

  @Column({ name: 'unique_email_count', type: 'integer', default: 0 })
  uniqueEmailCount: number;

  @Column({ type: 'text' })
  evidence: string;

  @Column({ length: 20, default: 'active' })
  status: string;

  @Column({ name: 'resolved_at', type: 'datetime', nullable: true })
  resolvedAt: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'resolved_by' })
  resolvedBy: User;

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes: string;

  @Column({ type: 'text', nullable: true })
  metadata: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @OneToMany(() => SecurityAlert, alert => alert.pattern)
  alerts: SecurityAlert[];

  @OneToMany(() => PatternLoginAttempt, patternAttempt => patternAttempt.pattern)
  patternLoginAttempts: PatternLoginAttempt[];
}
