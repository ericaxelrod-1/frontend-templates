import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('notification_preferences')
export class NotificationPreference {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ default: true })
  emailEnabled: boolean;

  @Column({ default: true })
  privacyEnabled: boolean;

  @Column({ default: true })
  securityEnabled: boolean;

  @Column({ default: true })
  systemEnabled: boolean;

  @UpdateDateColumn()
  updatedAt: Date;
}
