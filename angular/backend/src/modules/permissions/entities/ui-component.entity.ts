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


  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ length: 255, nullable: true })
  filePath: string;


  @ManyToMany(() => Permission, (permission) => permission.components)
  @JoinTable({
    name: 'ui_component_permissions',
    joinColumn: { name: 'ui_component_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  requiredPermissions: Permission[];

  @Column({ default: false })
  overridePermissions: boolean;


  @Column({ nullable: true })
  lastSyncedAt: Date;


  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

}
