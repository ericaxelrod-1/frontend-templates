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
import { Group } from './group.entity';
import { UserGroup } from './user-group.entity';
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

  @Column({ name: 'first_name', nullable: true })
  firstName: string;

  @Column({ name: 'last_name', nullable: true })
  lastName: string;

  @Column({ name: 'is_active', default: false })
  isActive: boolean;

  @Column({ name: 'is_email_verified', default: false })
  isEmailVerified: boolean;

  /**
   * Getter for backward compatibility with services expecting emailVerified
   * Returns the isEmailVerified value
   */
  get emailVerified(): boolean {
    return this.isEmailVerified;
  }

  /**
   * Setter for backward compatibility with services setting emailVerified
   * Sets the isEmailVerified field
   */
  set emailVerified(value: boolean) {
    this.isEmailVerified = value;
  }

  @Column({ name: 'last_login_at', nullable: true })
  lastLoginAt: Date;

  /**
   * Getter for backward compatibility with services expecting lastLogin
   * Returns the lastLoginAt value
   */
  get lastLogin(): Date {
    return this.lastLoginAt;
  }

  /**
   * Setter for backward compatibility with services setting lastLogin
   * Sets the lastLoginAt field
   */
  set lastLogin(value: Date) {
    this.lastLoginAt = value;
  }

  @Column({ name: 'requires_password_change', default: false })
  requiresPasswordChange: boolean;

  @Column({ type: 'simple-json', nullable: true })
  preferences: Record<string, any>;

  @Column({ name: 'email_verified_at', nullable: true })
  emailVerifiedAt: Date;

  @Column({ name: 'registration_verification_sent_at', nullable: true })
  registrationVerificationSentAt: Date;

  /**
   * Getter for backward compatibility with services expecting registrationVerificationSent
   * Returns the registrationVerificationSentAt value
   */
  get registrationVerificationSent(): Date {
    return this.registrationVerificationSentAt;
  }

  /**
   * Setter for backward compatibility with services setting registrationVerificationSent
   * Sets the registrationVerificationSentAt field
   */
  set registrationVerificationSent(value: Date) {
    this.registrationVerificationSentAt = value;
  }

  @Column({ name: 'user_verified_at', nullable: true })
  userVerifiedAt: Date;

  /**
   * Getter for backward compatibility with services expecting userVerified
   * Returns the userVerifiedAt value
   */
  get userVerified(): Date {
    return this.userVerifiedAt;
  }

  /**
   * Setter for backward compatibility with services setting userVerified
   * Sets the userVerifiedAt field
   */
  set userVerified(value: Date) {
    this.userVerifiedAt = value;
  }

  @Column({ name: 'is_deleted', default: false })
  isDeleted: boolean;

  @Column({ name: 'deleted_at', nullable: true })
  deletedAt: Date;

  @ManyToMany(() => Role, role => role.users)
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

  @ManyToMany(() => Group, group => group.users)
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

  @OneToMany(() => UserPermission, userPermission => userPermission.user)
  userPermissions: UserPermission[];

  @OneToMany(() => UserGroup, (userGroup) => userGroup.user)
  userGroups: UserGroup[];

  @ManyToMany(() => Permission)
  @JoinTable({
    name: 'user_permissions',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permissions: Permission[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
