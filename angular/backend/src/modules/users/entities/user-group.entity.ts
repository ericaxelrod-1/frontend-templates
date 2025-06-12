import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  PrimaryColumn,
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
  @PrimaryColumn({ name: 'user_id' })
  userId: number;

  @PrimaryColumn({ name: 'group_id' })
  groupId: number;

  @Column({ name: 'is_admin', default: false })
  isAdmin: boolean;

  /**
   * JSON string override for group permissions (nullable)
   */
  @Column({ name: 'group_permissions_override', type: 'text', nullable: true })
  groupPermissionsOverride: string;

  @Column({ name: 'joined_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  joinedAt: Date;

  @Column({ name: 'last_active_at', type: 'datetime', nullable: true })
  lastActiveAt: Date;

  @ManyToOne(() => User, (user) => user.userGroups)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Group, (group) => group.userGroups)
  @JoinColumn({ name: 'group_id' })
  group: Group;
}
