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

  @Column({ length: 50 })
  patternType: string;


  @Column({ length: 20, default: 'medium' })
  severity: string;

  @Column({ type: 'text' })
  ipAddress: string;


  @Column({
    type: 'datetime',
    default: () => "datetime('now')",
  })
  detectionTimestamp: Date;


  @Column({ type: 'datetime' })
  timeWindowStart: Date;

  @Column({ type: 'datetime' })
  timeWindowEnd: Date;


  @Column({ type: 'integer', default: 0 })
  attemptCount: number;

  @Column({ type: 'integer', default: 0 })
  uniqueEmailCount: number;


  @Column({ type: 'text' })
  evidence: string;

  @Column({ length: 20, default: 'active' })
  status: string;

  @Column({ type: 'datetime', nullable: true })
  resolvedAt: Date;


  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'resolved_by' })
  resolvedBy: User;

  @Column({ type: 'text', nullable: true })
  resolutionNotes: string;


  @Column({ type: 'text', nullable: true })
  metadata: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;


  // Relations
  @OneToMany(() => SecurityAlert, (alert) => alert.pattern)
  alerts: SecurityAlert[];

  @OneToMany(
    () => PatternLoginAttempt,
    (patternAttempt) => patternAttempt.pattern,
  )
  patternLoginAttempts: PatternLoginAttempt[];
}
