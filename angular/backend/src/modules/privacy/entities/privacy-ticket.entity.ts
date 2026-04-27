import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PrivacyJob } from './privacy-job.entity';

export enum PrivacyRequestType {
  EXPORT = 'export',
  ERASURE = 'erasure',
  RESTRICTION = 'restriction',
  OBJECTION = 'objection',
}

export enum PrivacyTicketStatus {
  PENDING = 'pending',
  IN_REVIEW = 'in_review',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum PrivacyRegulation {
  GDPR = 'gdpr',
  CCPA = 'ccpa',
  OTHER = 'other',
}

@Entity('privacy_tickets')
export class PrivacyTicket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'varchar',
    enum: PrivacyRequestType,
  })
  requestType: PrivacyRequestType;

  @Column({
    type: 'varchar',
    enum: PrivacyTicketStatus,
    default: PrivacyTicketStatus.PENDING,
  })
  status: PrivacyTicketStatus;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', nullable: true })
  userId: number;

  @Column({ nullable: true })
  email: string;

  @Column({
    type: 'varchar',
    enum: PrivacyRegulation,
  })
  regulation: PrivacyRegulation;

  @Column({ name: 'sla_deadline', type: 'datetime' })
  slaDeadline: Date;

  @Column({ name: 'accrued_paused_time', type: 'integer', default: 0 })
  accruedPausedTime: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => PrivacyJob, (job) => job.ticket)
  jobs: PrivacyJob[];
}
