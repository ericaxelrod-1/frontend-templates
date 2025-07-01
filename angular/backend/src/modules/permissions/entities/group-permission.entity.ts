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
  @PrimaryColumn({ name: 'group_id' })
  groupId: number;

  @PrimaryColumn({ name: 'permission_id' })
  permissionId: number;

  /**
   * Whether the permission is granted (true) or denied (false)
   * Used for explicit permission denial in hierarchical permission systems
   */
  @Column({ name: 'is_granted', default: true })
  isGranted: boolean;

  /**
   * Getter for backward compatibility with services expecting granted
   * Returns the isGranted value
   */
  get granted(): boolean {
    return this.isGranted;
  }

  /**
   * Setter for backward compatibility with services setting granted
   * Sets the isGranted field
   */
  set granted(value: boolean) {
    this.isGranted = value;
  }

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
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /**
   * Last update timestamp
   */
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
