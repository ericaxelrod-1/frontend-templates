import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { RlsJoinPath } from './rls-join-path.entity';

@Entity('rls_scope_templates')
export class RlsScopeTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ name: 'join_path_id' })
  joinPathId: number;

  @Column({ name: 'target_table' })
  targetTable: string;

  @Column({ name: 'available_columns', type: 'text' })
  availableColumns: string;

  @ManyToOne(() => RlsJoinPath, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'join_path_id' })
  joinPath: RlsJoinPath;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
