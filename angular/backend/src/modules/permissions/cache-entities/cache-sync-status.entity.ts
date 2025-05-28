import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

/**
 * Cache entity for tracking synchronization status.
 * This entity tracks the last synchronization between the main database and the cache.
 */
@Entity('cache_sync_status')
export class CacheSyncStatus {
  @PrimaryColumn()
  id: string;

  @Column()
  entityType: string; // 'component', 'route', 'endpoint', 'permission'

  @Column({ type: 'datetime' })
  lastSyncTime: Date;

  @Column('simple-json', { nullable: true })
  syncStats: {
    added: number;
    updated: number;
    deleted: number;
    unchanged: number;
    errors: number;
  };

  @Column({ nullable: true })
  error: string;

  @Column({ default: true })
  syncSuccessful: boolean;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;
}
