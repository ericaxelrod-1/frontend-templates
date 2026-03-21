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

@Entity('rls_join_conditions')
export class RlsJoinCondition {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'join_path_id' })
  joinPathId: number;

  @Column({ name: 'from_table', length: 255 })
  fromTable: string;

  @Column({ name: 'from_column', length: 255 })
  fromColumn: string;

  @Column({ name: 'to_table', length: 255 })
  toTable: string;

  @Column({ name: 'to_column', length: 255 })
  toColumn: string;

  @Column({ length: 50, default: '=' })
  operator: string;

  @ManyToOne(() => RlsJoinPath, (path) => path.conditions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'join_path_id' })
  joinPath: RlsJoinPath;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
