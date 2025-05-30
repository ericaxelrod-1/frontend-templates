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
   * Getter for backward compatibility with services expecting path
   * Returns the id which contains the path value
   */
  get path(): string {
    return this.id;
  }

  /**
   * Setter for backward compatibility with services setting path
   * Sets the id field with the path value
   */
  set path(value: string) {
    this.id = value;
  }

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
  @Column({ name: 'component_name', nullable: true, length: 255 })
  componentName: string;

  /**
   * Getter for backward compatibility with services expecting component
   * Returns the componentName value
   */
  get component(): string {
    return this.componentName;
  }

  /**
   * Setter for backward compatibility with services setting component
   * Sets the componentName field
   */
  set component(value: string) {
    this.componentName = value;
  }

  /**
   * Whether this route overrides default permissions
   * If true, only explicitly assigned permissions apply
   * If false, inherited permissions from parent resources apply
   */
  @Column({ name: 'override_permissions', default: false })
  overridePermissions: boolean;

  /**
   * Last time this route was synced with the codebase
   * Used to detect stale routes
   */
  @Column({ name: 'last_synced_at', nullable: true })
  lastSyncedAt: Date;

  /**
   * Getter for backward compatibility with services expecting lastSynced
   * Returns the lastSyncedAt value
   */
  get lastSynced(): Date {
    return this.lastSyncedAt;
  }

  /**
   * Setter for backward compatibility with services setting lastSynced
   * Sets the lastSyncedAt field
   */
  set lastSynced(value: Date) {
    this.lastSyncedAt = value;
  }

  /**
   * Whether this route is disabled
   */
  @Column({ name: 'is_disabled', default: false })
  isDisabled: boolean;

  /**
   * Whether this route should be shown in the navigation menu
   */
  @Column({ name: 'show_in_menu', default: true })
  showInMenu: boolean;

  /**
   * Icon name for menu display
   */
  @Column({ nullable: true, length: 255 })
  icon: string;

  /**
   * Order in menu (lower numbers appear first)
   */
  @Column({ name: 'menu_order', default: 100 })
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
