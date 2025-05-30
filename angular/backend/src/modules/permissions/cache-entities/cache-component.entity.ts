import { 
  Entity, 
  Column, 
  PrimaryGeneratedColumn, 
  CreateDateColumn, 
  UpdateDateColumn 
} from 'typeorm';

/**
 * Cache entity for UI components.
 * Stores UI component metadata and permission requirements for fast lookups.
 * Aligned with database schema as of 2025-05-23
 */
@Entity('cache_components')
export class CacheComponent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255, unique: true })
  selector: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'file_path', length: 255, nullable: true })
  filePath: string;

  @Column({ name: 'last_synced_at', nullable: true })
  lastSyncedAt: Date;

  @Column({ type: 'text', nullable: true })
  metadata: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
