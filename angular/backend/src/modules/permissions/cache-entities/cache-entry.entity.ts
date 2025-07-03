import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Base class for cache entries
 * Used by the cache-sync service to store permission data for faster access
 */
export class CacheEntryBase {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * Type of cache entry (route, endpoint, component, etc.)
   */
  @Column()
  type: string;

  /**
   * Name of the resource (e.g., route path, endpoint path, component name)
   */
  @Column()
  name: string;

  /**
   * Type of resource this entry applies to
   */
  @Column({ nullable: true })
  resourceType: string;

  /**
   * ID of the resource this entry applies to
   */
  @Column({ nullable: true })
  resourceId: number;

  /**
   * Action being performed on the resource
   */
  @Column({ nullable: true })
  action: string;

  /**
   * Role ID if this entry is for a specific role
   */
  @Column({ nullable: true })
  roleId: number;

  /**
   * Group ID if this entry is for a specific group
   */
  @Column({ nullable: true })
  groupId: number;

  /**
   * User ID if this entry is for a specific user
   */
  @Column({ nullable: true })
  userId: number;

  /**
   * Whether the permission is granted or denied
   */
  @Column({ default: true })
  granted: boolean;

  /**
   * Priority of this entry (higher priority entries override lower priority ones)
   */
  @Column({ default: 0 })
  priority: number;

  /**
   * Required permissions for this entry
   * This is a calculated property that is not stored in the database
   */
  permissions: string[];

  /**
   * When this entry was last synced with the database
   */
  @Column({ nullable: true })
  lastSynced: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
