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
  USER: 'user', // id: 1
  SUPERUSER: 'superuser', // id: 3
  ADMIN: 'Administrator', // id: 6
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

  @Column({ default: false })
  isSystemRole: boolean;

  @Column({ default: false })
  isDefault: boolean;

  // Parent-child relationship
  @Column({ nullable: true })
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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
