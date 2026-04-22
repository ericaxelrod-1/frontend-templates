import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { SecurityDetectedPattern } from './security-detected-pattern.entity';

@Entity('security_alerts')
export class SecurityAlert {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50 })
  alertType: string;

  @Column({ length: 20, default: 'medium' })
  severity: string;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ length: 50, default: 'system' })
  source: string;

  @ManyToOne(() => SecurityDetectedPattern, (pattern) => pattern.alerts, {
    nullable: true,
  })
  @JoinColumn({ name: 'pattern_id' })
  pattern: SecurityDetectedPattern;

  @Column({ type: 'text', nullable: true })
  ipAddress: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ length: 20, default: 'active' })
  status: string;

  @Column({ type: 'datetime', nullable: true })
  acknowledgedAt: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'acknowledged_by' })
  acknowledgedBy: User;

  @Column({ type: 'datetime', nullable: true })
  resolvedAt: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'resolved_by' })
  resolvedBy: User;

  @Column({ type: 'text', nullable: true })
  resolutionNotes: string;

  @Column({ type: 'text', nullable: true })
  alertData: string;

  @Column({ type: 'datetime', nullable: true })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
