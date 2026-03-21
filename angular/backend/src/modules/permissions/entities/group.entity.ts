import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToMany,
  ManyToOne,
  JoinColumn,
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
  @OneToMany(() => GroupPermission, (groupPermission) => groupPermission.group)
  groupPermissions: GroupPermission[];

  /**
   * Flag to indicate if this is a system-managed group that shouldn't be modified
   */
  @Column({ default: false })
  isSystemGroup: boolean;


  /**
   * Owner of the group (nullable FK to users.id)
   */
  @Column({ nullable: true })
  ownerId: number;


  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;


  @ManyToMany(() => User, (user) => user.groups)
  users: User[];

  @Column({ nullable: true })
  parentId: number;

  @ManyToOne(() => Group, (group) => group.children, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parent_id' })
  parent: Group;

  @OneToMany(() => Group, (group) => group.parent)
  children: Group[];

  @Column({ nullable: true })
  priority: number;
}
