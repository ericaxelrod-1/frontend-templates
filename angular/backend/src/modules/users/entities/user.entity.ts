import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { Role } from '../../roles/entities/role.entity';
import { Group } from '../../permissions/entities/group.entity';
import { UserPermission } from '../../permissions/entities/user-permission.entity';
import { Permission } from '../../permissions/entities/permission.entity';
import { Exclude } from 'class-transformer';

/**
 * User entity representing a system user
 * Aligned with database schema as of 2025-05-16
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  username: string;

  @Column()
  @Exclude()
  password: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  firstName: string;

  @Column({ nullable: true })
  lastName: string;

  @Column({ default: false })
  isActive: boolean;

  @Column({ default: false })
  isEmailVerified: boolean;

  @Column({ nullable: true })
  lastLoginAt: Date;

  @Column({ default: false })
  requiresPasswordChange: boolean;

  @Column({ type: 'simple-json', nullable: true })
  preferences: Record<string, any>;

  @Column({ nullable: true })
  emailVerifiedAt: Date;

  @Column({ nullable: true })
  registrationVerificationSentAt: Date;

  @Column({ nullable: true })
  userVerifiedAt: Date;

  @Column({ default: false })
  isDeleted: boolean;

  @Column({ nullable: true })
  deletedAt: Date;

  @Column({ default: false })
  isBlocked: boolean;

  @Column({ nullable: true })
  blockedAt: Date;

  @Column({ nullable: true })
  blockedUntil: Date;

  @Column({ type: 'text', nullable: true })
  blockedReason: string;

  @Column({ default: false })
  marketingConsent: boolean;

  @Column({ default: false })
  doNotSell: boolean;

  @Column({ nullable: true })
  consentUpdatedAt: Date;

  @Column({ type: 'simple-json', nullable: true })
  privacyRestrictions: Record<string, boolean>;

  @Column({ nullable: true })
  processingObjectionAt: Date;

  @Column({ type: 'simple-json', nullable: true })
  processingObjections: Record<string, string>;

  @ManyToMany(() => Role, (role) => role.users)
  @JoinTable({
    name: 'user_roles',
    joinColumn: {
      name: 'user_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'role_id',
      referencedColumnName: 'id',
    },
  })
  roles: Role[];

  @ManyToMany(() => Group, (group) => group.users)
  @JoinTable({
    name: 'user_groups',
    joinColumn: {
      name: 'user_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'group_id',
      referencedColumnName: 'id',
    },
  })
  groups: Group[];

  @OneToMany(() => UserPermission, (userPermission) => userPermission.user)
  userPermissions: UserPermission[];

  @ManyToMany(() => Permission)
  @JoinTable({
    name: 'user_permissions',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permissions: Permission[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
