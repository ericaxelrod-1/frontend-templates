import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { Permission } from './permission.entity';

/**
 * Represents a UI component in the application
 * Used for tracking and managing permissions on components
 */
@Entity('components')
export class Component {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * The unique identifier for the component
   */
  @Column({ unique: true })
  name: string;

  /**
   * The selector used in templates (app-user-list, etc.)
   */
  @Column({ nullable: true })
  selector: string;

  /**
   * A description of what this component does
   */
  @Column({ nullable: true })
  description: string;

  /**
   * Whether this component overrides default permissions
   * If true, only explicitly assigned permissions apply
   * If false, inherited permissions from parent resources apply
   */
  @Column({ default: false })
  overridePermissions: boolean;

  /**
   * Last time this component was synced with the codebase
   * Used to detect stale components
   */
  @Column({ nullable: true })
  lastSyncedAt: Date;

  /**
   * The module that declares this component
   */
  @Column({ nullable: true })
  module: string;

  /**
   * Relationship to the permissions required to access this component
   */
  @ManyToMany(() => Permission)
  @JoinTable({
    name: 'component_permissions',
    joinColumn: { name: 'component_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  requiredPermissions: Permission[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
