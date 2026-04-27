import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PrivacyTicket } from './privacy-ticket.entity';

export enum PrivacyJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('privacy_jobs')
export class PrivacyJob {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => PrivacyTicket, (ticket) => ticket.jobs)
  @JoinColumn({ name: 'ticket_id' })
  ticket: PrivacyTicket;

  @Column({ name: 'ticket_id' })
  ticketId: number;

  @Column({
    type: 'varchar',
    enum: PrivacyJobStatus,
    default: PrivacyJobStatus.PENDING,
  })
  status: PrivacyJobStatus;

  @Column({ name: 'provider_results', type: 'simple-json', nullable: true })
  providerResults: Record<string, any>;

  @Column({ name: 'locked_at', type: 'datetime', nullable: true })
  lockedAt: Date;

  @Column({ name: 'error_log', type: 'text', nullable: true })
  errorLog: string;
}
