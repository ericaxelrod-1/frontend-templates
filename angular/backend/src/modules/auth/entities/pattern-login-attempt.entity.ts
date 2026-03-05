import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { SecurityDetectedPattern } from './security-detected-pattern.entity';
import { LoginAttempt } from './login-attempt.entity';

@Entity('pattern_login_attempts')
@Unique(['pattern', 'loginAttempt'])
export class PatternLoginAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(
    () => SecurityDetectedPattern,
    (pattern) => pattern.patternLoginAttempts,
  )
  @JoinColumn({ name: 'pattern_id' })
  pattern: SecurityDetectedPattern;

  @ManyToOne(() => LoginAttempt)
  @JoinColumn({ name: 'login_attempt_id' })
  loginAttempt: LoginAttempt;

  @Column({ type: 'boolean', default: false })
  isPrimaryEvidence: boolean;


  @CreateDateColumn()
  createdAt: Date;

}
