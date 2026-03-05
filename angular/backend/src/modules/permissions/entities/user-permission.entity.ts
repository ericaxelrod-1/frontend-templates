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
import { User } from '../../users/entities/user.entity';

/**
 * Represents the many-to-many relationship between users and permissions
 * Aligned with database schema as of 2025-05-16
 */
@Entity('user_permissions')
export class UserPermission {
  @PrimaryColumn()
  userId: number;

  @PrimaryColumn()
  permissionId: number;


  /**
   * Whether the permission is granted (true) or denied (false)
   * Used for explicit permission denial in hierarchical permission systems
   * This allows for overriding group and role permissions at the user level
   */
  @Column({ default: true })
  isGranted: boolean;


  /**
   * User relationship
   */
  @ManyToOne(() => User, (user) => user.userPermissions)
  @JoinColumn({ name: 'user_id' })
  user: User;

  /**
   * Permission relationship
   */
  @ManyToOne(() => Permission, (permission) => permission.userPermissions)
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
