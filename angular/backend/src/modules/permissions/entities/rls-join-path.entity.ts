import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { RlsJoinCondition } from './rls-join-condition.entity';

@Entity('rls_join_paths')
export class RlsJoinPath {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ name: 'target_table' })
  targetTable: string;

  @Column({ type: 'text' })
  chain: string;

  @OneToMany(() => RlsJoinCondition, (condition) => condition.joinPath)
  conditions: RlsJoinCondition[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
