import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
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

  @Column({ length: 100, nullable: true })
  controllerName: string;

  @Column({ length: 100, nullable: true })
  handlerName: string;

  @Column({ nullable: true })
  lastSyncedAt: Date;

  @Column({ type: 'text', nullable: true })
  metadata: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
