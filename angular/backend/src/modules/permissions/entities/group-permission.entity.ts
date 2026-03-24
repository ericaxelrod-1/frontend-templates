import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  PrimaryColumn,
} from 'typeorm';
import { Permission } from './permission.entity';
import { Group } from './group.entity';

/**
 * Represents the many-to-many relationship between groups and permissions
 * Aligned with database schema as of 2025-05-16
 */
@Entity('group_permissions')
export class GroupPermission {
  @PrimaryColumn()
  groupId: number;

  @PrimaryColumn()
  permissionId: number;

  /**
   * Whether the permission is granted (true) or denied (false)
   * Used for explicit permission denial in hierarchical permission systems
   */
  @Column({ default: true })
  isGranted: boolean;

  /**
   * Group relationship
   */
  @ManyToOne(() => Group, (group) => group.groupPermissions)
  @JoinColumn({ name: 'group_id' })
  group: Group;

  /**
   * Permission relationship
   */
  @ManyToOne(() => Permission, (permission) => permission.groupPermissions)
  @JoinColumn({ name: 'permission_id' })
  permission: Permission;

  /**
   * Creation timestamp
   */
  @CreateDateColumn()
  createdAt: Date;

  /**
   * Last update timestamp
   */
  @UpdateDateColumn()
  updatedAt: Date;
}
