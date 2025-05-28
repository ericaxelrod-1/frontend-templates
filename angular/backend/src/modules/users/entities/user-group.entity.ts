import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Group } from './group.entity';

/**
 * UserGroup entity represents the many-to-many relationship between users and groups
 * and manages group-specific permissions for each user.
 * Aligned with database schema as of 2025-05-16
 */
@Entity('user_groups')
export class UserGroup {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @Column({ name: 'group_id' })
  groupId: number;

  @ManyToOne(() => User, (user) => user.userGroups)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Group, (group) => group.userGroups)
  @JoinColumn({ name: 'group_id' })
  group: Group;

  @Column({ name: 'is_admin', type: 'boolean', default: false })
  isAdmin: boolean;

  /**
   * JSON string override for group permissions (nullable)
   */
  @Column({ name: 'group_permissions_override', type: 'text', nullable: true })
  groupPermissionsOverride: string;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt: Date;

  @Column({ name: 'last_active_at', nullable: true })
  lastActiveAt: Date;
}
