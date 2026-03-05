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
  @Column({ nullable: true, length: 100 })
  controllerName: string;

  /**
   * Handler method name in the controller
   * Used for tracing and documentation
   */
  @Column({ nullable: true, length: 100 })
  handlerName: string;


  /**
   * Whether this endpoint overrides default permissions
   * If true, only explicitly assigned permissions apply
   * If false, inherited permissions from parent resources apply
   */
  @Column({ default: false })
  overridePermissions: boolean;


  /**
   * Last time this endpoint was synced with the codebase
   * Used to detect stale endpoints
   */
  @Column({ nullable: true })
  lastSyncedAt: Date;


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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

}
