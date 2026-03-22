import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { RlsConditionGroup } from './rls-condition-group.entity';

@Entity('rls_rule_conditions')
export class RlsRuleCondition {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'condition_group_id' }) conditionGroupId: number;
  @Column({ name: 'column_name' }) columnName: string;
  @Column() operator: string;
  @Column({ type: 'text', nullable: true }) value: string | null;
  @Column({ name: 'sort_order', default: 0 }) sortOrder: number;
  @ManyToOne(() => RlsConditionGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'condition_group_id' }) conditionGroup: RlsConditionGroup;
}