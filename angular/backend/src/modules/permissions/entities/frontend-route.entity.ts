import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { Permission } from './permission.entity';

/**
 * Represents a frontend route in the application
 * Used for tracking and managing permissions on routes
 * Aligned with database schema as of 2025-05-16
 */
@Entity('frontend_routes')
export class FrontendRoute {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  id: string;

  /**
   * The display name of the route for UI menus
   */
  @Column({ nullable: true, length: 255 })
  title: string;

  /**
   * A description of what this route provides
   */
  @Column({ type: 'text', nullable: true })
  description: string;

  /**
   * The component name that renders this route
   * Used for documentation and debugging
   */
  @Column({ nullable: true, length: 255 })
  componentName: string;

  /**
   * Whether this route overrides default permissions
   * If true, only explicitly assigned permissions apply
   * If false, inherited permissions from parent resources apply
   */
  @Column({ default: false })
  overridePermissions: boolean;

  @Column({ nullable: true })
  lastSyncedAt: Date;

  /**
   * Whether this route is disabled
   */
  @Column({ default: false })
  isDisabled: boolean;

  /**
   * Whether this route should be shown in the navigation menu
   */
  @Column({ default: true })
  showInMenu: boolean;

  /**
   * Icon name for menu display
   */
  @Column({ nullable: true, length: 255 })
  icon: string;

  /**
   * Order in menu (lower numbers appear first)
   */
  @Column({ default: 100 })
  menuOrder: number;

  /**
   * Relationship to the permissions required to access this route
   */
  @ManyToMany(() => Permission)
  @JoinTable({
    name: 'frontend_route_permissions',
    joinColumn: { name: 'frontend_route_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  requiredPermissions: Permission[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
