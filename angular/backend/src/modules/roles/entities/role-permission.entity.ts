import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique
} from 'typeorm';
import { Role } from './role.entity';
import { Permission } from '../../permissions/entities/permission.entity';

/**
 * Represents the many-to-many relationship between roles and permissions
 * with the addition of a "granted" flag to indicate if the permission is granted or denied
 * Aligned with database schema as of 2025-05-16
 */
@Entity('role_permissions')
@Unique(['roleId', 'permissionId'])
export class RolePermission {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'role_id' })
  roleId: number;

  @Column({ name: 'permission_id' })
  permissionId: number;

  /**
   * Whether the permission is granted (true) or denied (false)
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Role, role => role.rolePermissions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id', referencedColumnName: 'id' })
  role: Role;

  @ManyToOne(() => Permission, permission => permission.rolePermissions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permission_id', referencedColumnName: 'id' })
  permission: Permission;
}
