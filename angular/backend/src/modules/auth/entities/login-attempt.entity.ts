import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('login_attempts')
export class LoginAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'ip_address', type: 'text' })
  ipAddress: string;

  @Column({ name: 'user_agent', type: 'text' })
  userAgent: string;

  @Column({ name: 'email_attempted', type: 'text', nullable: true })
  emailAttempted: string;

  @Column({ type: 'text', default: 'failed' })
  status:
    | 'success'
    | 'failed'
    | 'blocked'
    | 'captcha_required'
    | 'captcha_failed';

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string;

  @Column({ type: 'text', nullable: true })
  metadata: string;

  @CreateDateColumn({ name: 'attempted_at', type: 'datetime' })
  attemptedAt: Date;

  /**
   * Getter for backward compatibility with services expecting createdAt
   * Returns the attemptedAt value
   */
  get createdAt(): Date {
    return this.attemptedAt;
  }

  /**
   * Setter for backward compatibility with services setting createdAt
   * Sets the attemptedAt field
   */
  set createdAt(value: Date) {
    this.attemptedAt = value;
  }
}
