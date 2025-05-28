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
 * Represents an API endpoint in the system
 * Used for tracking and managing permissions on API endpoints
 * Aligned with database schema as of 2025-05-16
 */
@Entity('api_endpoints')
export class ApiEndpoint {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  id: string;

  /**
   * The HTTP method (GET, POST, PUT, DELETE, etc.)
   */
  @Column({ length: 20 })
  method: string;

  /**
   * The path of the endpoint (/api/users, /api/auth/login, etc.)
   */
  @Column({ length: 255 })
  path: string;

  /**
   * A description of what this endpoint does
   */
  @Column({ type: 'text', nullable: true })
  description: string;

  /**
   * Controller name that handles this endpoint
   * Used for tracing and documentation
   */
  @Column({ name: 'controller_name', nullable: true, length: 100 })
  controllerName: string;

  /**
   * Handler method name in the controller
   * Used for tracing and documentation
   */
  @Column({ name: 'handler_name', nullable: true, length: 100 })
  handlerName: string;

  /**
   * Whether this endpoint overrides default permissions
   * If true, only explicitly assigned permissions apply
   * If false, inherited permissions from parent resources apply
   */
  @Column({ name: 'override_permissions', default: false })
  overridePermissions: boolean;

  /**
   * Last time this endpoint was synced with the codebase
   * Used to detect stale endpoints
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
   * Relationship to the permissions required to access this endpoint
   */
  @ManyToMany(() => Permission)
  @JoinTable({
    name: 'api_endpoint_permissions',
    joinColumn: { name: 'api_endpoint_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  requiredPermissions: Permission[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
