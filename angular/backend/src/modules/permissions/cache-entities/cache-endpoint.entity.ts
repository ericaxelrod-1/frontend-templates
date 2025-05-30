import { 
  Entity, 
  Column, 
  PrimaryGeneratedColumn, 
  CreateDateColumn, 
  UpdateDateColumn,
  Unique 
} from 'typeorm';

/**
 * Cache entity for API endpoints.
 * Stores endpoint metadata and permission requirements for fast lookups.
 * Aligned with database schema as of 2025-05-23
 */
@Entity('cache_endpoints')
@Unique(['method', 'path'])
export class CacheEndpoint {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 20 })
  method: string;

  @Column({ length: 255 })
  path: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'controller_name', length: 100, nullable: true })
  controllerName: string;

  @Column({ name: 'handler_name', length: 100, nullable: true })
  handlerName: string;

  @Column({ name: 'last_synced_at', nullable: true })
  lastSyncedAt: Date;

  @Column({ type: 'text', nullable: true })
  metadata: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
