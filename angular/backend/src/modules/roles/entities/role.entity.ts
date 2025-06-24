import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { RolePermission } from './role-permission.entity';

// Define role types as a string literal type - this provides type safety while allowing flexibility
// These match the exact role names in the database (preferred roles with lowest IDs)
export const SystemRoles = {
  USER: 'user',                    // id: 1
  SUPERUSER: 'superuser',          // id: 3  
  ADMIN: 'Administrator',          // id: 6
  SUPERADMIN: 'Super Administrator', // id: 8
} as const;

export type SystemRoleType = (typeof SystemRoles)[keyof typeof SystemRoles];

// Export UserRole for backward compatibility
export const UserRole = SystemRoles;

/**
 * Role entity representing user roles in the system
 */
@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, unique: true, nullable: false })
  name: string;

  @Column({ length: 255, nullable: true })
  description: string;

  @Column({ default: false, name: 'is_system_role' })
  isSystemRole: boolean;

  @Column({ default: false, name: 'is_default' })
  isDefault: boolean;

  // Parent-child relationship
  @Column({ nullable: true, name: 'parent_id' })
  parentId: number;

  @ManyToOne(() => Role, (role) => role.children, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parent_id' })
  parent: Role;

  @OneToMany(() => Role, (role) => role.parent)
  children: Role[];

  @Column({ nullable: true })
  priority: number;

  @ManyToMany(() => User, (user) => user.roles)
  users: User[];

  @OneToMany(() => RolePermission, (rolePermission) => rolePermission.role)
  rolePermissions: RolePermission[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
