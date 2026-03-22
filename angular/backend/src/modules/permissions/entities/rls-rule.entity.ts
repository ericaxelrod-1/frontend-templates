import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Group } from './group.entity';
import { RlsConditionGroup } from './rls-condition-group.entity';

@Entity('rls_rules')
export class RlsRule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'group_id' })
  groupId: number;

  @Column({ name: 'target_table' })
  targetTable: string;

  @Column({ type: 'int', nullable: true })
  isActive: boolean;

  @Column({ type: 'int', nullable: true })
  priority: number;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'root_group_id', nullable: true })
  rootGroupId: number | null;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group: Group;

  @OneToMany(() => RlsConditionGroup, g => g.rule)
  conditionGroups: RlsConditionGroup[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
