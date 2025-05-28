import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Cache entity for denormalized permission mappings.
 * This entity provides a flattened view of permissions for quick lookups.
 */
@Entity('cache_permission_maps')
export class CachePermissionMap {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  type: string;

  @Column()
  name: string;

  @Column()
  resourceType: string; // 'component', 'route', or 'endpoint'

  @Column()
  resourceId: string;

  @Column()
  action: string;

  @Column({ nullable: true })
  roleId: number | null;

  @Column({ nullable: true })
  groupId: number | null;

  @Column({ nullable: true })
  userId: number | null;

  @Column({ default: true })
  granted: boolean;

  @Column({ default: 0 })
  priority: number;

  /**
   * List of permission strings required for this resource
   * Stored as comma-separated values in the database
   */
  @Column({ nullable: true, type: 'simple-array' })
  permissions: string[];

  @CreateDateColumn({ name: 'last_synced' })
  lastSynced: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
