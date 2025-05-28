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

  /**
   * Getter for backward compatibility with services expecting email
   * Returns the emailAttempted value
   */
  get email(): string {
    return this.emailAttempted;
  }

  /**
   * Setter for backward compatibility with services setting email
   * Sets the emailAttempted field
   */
  set email(value: string) {
    this.emailAttempted = value;
  }

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

  /**
   * Getter for backward compatibility with services expecting userId
   * Returns the user.id value if user is loaded
   */
  get userId(): number | null {
    return this.user?.id || null;
  }

  /**
   * Setter for backward compatibility with services setting userId
   * This is a no-op since the relationship should be set via the user property
   */
  set userId(value: number | null) {
    // This setter exists for backward compatibility but doesn't do anything
    // The userId should be set by assigning to the user property
    console.warn('Setting userId directly is deprecated. Set the user property instead.');
  }

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
