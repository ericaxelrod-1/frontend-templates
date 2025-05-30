import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  JoinTable,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Permission } from './permission.entity';

/**
 * Entity representing a UI component with its permissions
 */
@Entity('ui_components')
export class UiComponent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  selector: string;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true })
  filePath: string;

  @ManyToMany(() => Permission, (permission) => permission.components)
  @JoinTable({
    name: 'ui_component_permissions',
    joinColumn: { name: 'component_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  requiredPermissions: Permission[];

  @Column({ default: false })
  overridePermissions: boolean;

  @Column({ nullable: true })
  lastSynced: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
} 