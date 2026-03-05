import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
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

  @Column({ length: 255, nullable: true })
  filePath: string;


  @Column({ nullable: true })
  lastSyncedAt: Date;


  @Column({ type: 'text', nullable: true })
  metadata: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

}
