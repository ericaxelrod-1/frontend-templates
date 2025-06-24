import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToMany,
  ManyToOne,
  JoinColumn
} from 'typeorm';
import { GroupPermission } from './group-permission.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Group entity representing a collection of users with shared permissions
 * Aligned with database schema as of 2025-05-16
 */
@Entity('groups')
export class Group {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50, unique: true })
  name: string;

  @Column({ length: 255, nullable: true })
  description: string;

  /**
   * Settings for the group - stored as a JSON string in TEXT column (SQLite)
   * Code should handle JSON.parse/stringify as needed
   */
  @Column({ type: 'text', nullable: true })
  settings: string;

  /**
   * Relationships with GroupPermission join entity
   */
  @OneToMany(
    () => GroupPermission,
    (groupPermission) => groupPermission.group,
  )
  groupPermissions: GroupPermission[];
  

  
  /**
   * Flag to indicate if this is a system-managed group that shouldn't be modified
   */
  @Column({ name: 'is_system_group', default: false })
  isSystemGroup: boolean;

  /**
   * Owner of the group (nullable FK to users.id)
   */
  @Column({ name: 'owner_id', nullable: true })
  ownerId: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToMany(() => User, user => user.groups)
  users: User[];
} 