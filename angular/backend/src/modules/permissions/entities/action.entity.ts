import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Permission } from './permission.entity';

/**
 * Represents an action that can be performed on a resource
 * Examples: create, read, update, delete, etc.
 * Aligned with database schema as of 2025-05-16
 */
@Entity('actions')
export class Action {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * The name of the action (e.g., 'create', 'read', 'update', 'delete')
   * Must be unique
   */
  @Column({ unique: true, length: 255 })
  name: string;

  /**
   * A description of what this action represents
   */
  @Column({ nullable: true, length: 255 })
  description: string;

  /**
   * The system code for consistent identification
   * Used for system-level permission checks
   */
  @Column({ name: 'action_code', unique: true, length: 255 })
  actionCode: string;

  /**
   * Icon to represent this action in the UI
   */
  @Column({ nullable: true, length: 255 })
  icon: string;

  /**
   * Category for grouping actions (nullable)
   */
  @Column({ nullable: true, length: 100 })
  category: string;

  /**
   * Reference to the permissions that use this action
   */
  @OneToMany(() => Permission, (permission) => permission.actionEntity)
  permissions: Permission[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
