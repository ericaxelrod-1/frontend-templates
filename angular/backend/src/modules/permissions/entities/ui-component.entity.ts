import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToMany,
  JoinTable,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Permission } from './permission.entity';

/**
 * Entity representing a UI component with its permissions
 * Aligned with database schema as of 2025-05-16
 */
@Entity('ui_components')
export class UiComponent {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  id: string;

  /**
   * Getter for backward compatibility with services expecting selector
   * Returns the id which contains the selector value
   */
  get selector(): string {
    return this.id;
  }

  /**
   * Setter for backward compatibility with services setting selector
   * Sets the id field with the selector value
   */
  set selector(value: string) {
    this.id = value;
  }

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'file_path', length: 255, nullable: true })
  filePath: string;

  @ManyToMany(() => Permission, (permission) => permission.components)
  @JoinTable({
    name: 'ui_component_permissions',
    joinColumn: { name: 'ui_component_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  requiredPermissions: Permission[];

  @Column({ name: 'override_permissions', default: false })
  overridePermissions: boolean;

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
