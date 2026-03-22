import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { RlsRule } from './rls-rule.entity';
import { RlsRuleCondition } from './rls-rule-condition.entity';

@Entity('rls_condition_groups')
export class RlsConditionGroup {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'rule_id' }) ruleId: number;
  @Column({ name: 'parent_group_id', nullable: true }) parentGroupId: number | null;
  @Column({ name: 'logical_operator', default: 'AND' }) logicalOperator: 'AND' | 'OR';
  @Column({ name: 'sort_order', default: 0 }) sortOrder: number;
  @ManyToOne(() => RlsRule, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rule_id' }) rule: RlsRule;
  @ManyToOne(() => RlsConditionGroup, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_group_id' }) parentGroup: RlsConditionGroup | null;
  @OneToMany(() => RlsConditionGroup, g => g.parentGroup) childGroups: RlsConditionGroup[];
  @OneToMany(() => RlsRuleCondition, c => c.conditionGroup) conditions: RlsRuleCondition[];
}