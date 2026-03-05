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

  @Column({ type: 'text' })
  ipAddress: string;

  @Column({ type: 'text' })
  userAgent: string;

  @Column({ type: 'text', nullable: true })
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

  @Column({ type: 'text', nullable: true })
  failureReason: string;


  @Column({ type: 'text', nullable: true })
  metadata: string;

  @CreateDateColumn({ type: 'datetime' })
  attemptedAt: Date;

}
