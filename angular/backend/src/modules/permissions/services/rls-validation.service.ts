import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RlsRule } from '../entities/rls-rule.entity';
import { Group } from '../entities/group.entity';
import { ScopeGroupDto, ScopeGroupItemDto, ScopeConditionDto } from '../dto/rls-rule.dto';

export interface ValidationWarning {
  type: 'self_conflict' | 'parent_conflict';
  severity: 'error' | 'warning';
  message: string;
  details: {
    ruleId?: number;
    conflictingColumn?: string;
    conflictingValues?: string[];
  };
}

export interface ValidationResult {
  valid: boolean;
  warnings: ValidationWarning[];
  canSave: boolean;
}

@Injectable()
export class RlsValidationService {
  constructor(
    @InjectRepository(RlsRule)
    private readonly rlsRuleRepository: Repository<RlsRule>,
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
  ) {}

  async validateRule(
    groupId: number,
    scope: ScopeGroupDto,
    targetTable: string,
    existingRuleId?: number,
  ): Promise<ValidationResult> {
    const warnings: ValidationWarning[] = [];

    const selfConflict = this.checkSelfConflict(scope);
    if (selfConflict) {
      warnings.push({
        type: 'self_conflict',
        severity: 'error',
        message: 'Rule contradicts itself and will match 0 rows',
        details: { conflictingColumn: selfConflict.column },
      });
    }

    const parentConflict = await this.checkParentConflict(groupId, scope, targetTable, existingRuleId);
    if (parentConflict) {
      warnings.push({
        type: 'parent_conflict',
        severity: 'warning',
        message: `Rule may restrict access beyond parent group scope: column '${parentConflict.column}' has narrower conditions`,
        details: {
          conflictingColumn: parentConflict.column,
          conflictingValues: [parentConflict.parentValue, parentConflict.childValue],
        },
      });
    }

    return {
      valid: warnings.filter(w => w.severity === 'error').length === 0,
      warnings,
      canSave: true,
    };
  }

  async validateParentRuleUpdate(
    groupId: number,
    newScope: ScopeGroupDto,
    targetTable: string,
  ): Promise<ValidationResult> {
    const warnings: ValidationWarning[] = [];

    const childRules = await this.rlsRuleRepository.find({
      where: { targetTable },
      relations: ['group', 'conditionGroups', 'conditionGroups.conditions'],
    });

    for (const childRule of childRules) {
      if (!childRule.group || !(await this.isDescendant(childRule.group, groupId))) {
        continue;
      }

      const childScope = await this.buildScopeFromRule(childRule);
      if (!childScope) continue;

      const conflict = this.checkChildConflict(newScope, childScope, childRule.group.name);
      if (conflict) {
        warnings.push({
          type: 'parent_conflict',
          severity: 'warning',
          message: `Updating parent rule will affect child group '${childRule.group.name}': ${conflict.message}`,
          details: {
            ruleId: childRule.id,
            conflictingColumn: conflict.column,
          },
        });
      }
    }

    return {
      valid: true,
      warnings,
      canSave: true,
    };
  }

  private async buildScopeFromRule(rule: RlsRule): Promise<ScopeGroupDto | null> {
    if (!rule.conditionGroups || rule.conditionGroups.length === 0) {
      return null;
    }

    const rootGroup = rule.conditionGroups.find(g => g.parentGroupId === null);
    if (!rootGroup) return null;

    return this.buildScopeGroup(rootGroup, rule.conditionGroups);
  }

  private buildScopeGroup(group: any, allGroups: any[]): ScopeGroupDto {
    const conditions: ScopeGroupItemDto[] = [];

    if (group.conditions) {
      for (const cond of group.conditions) {
        conditions.push({
          column: cond.columnName,
          operator: cond.operator,
          value: cond.value || undefined,
        } as ScopeConditionDto);
      }
    }

    const childGroups = allGroups.filter(g => g.parentGroupId === group.id);
    for (const childGroup of childGroups) {
      conditions.push(this.buildScopeGroup(childGroup, allGroups));
    }

    return {
      logicalOperator: group.logicalOperator as 'AND' | 'OR',
      conditions,
    };
  }

  private checkSelfConflict(scope: ScopeGroupDto): { column: string } | null {
    const conditions = this.flattenConditions(scope);
    const columnConditions = new Map<string, Array<{ operator: string; value: string; negated: boolean }>>();

    for (const cond of conditions) {
      if (!columnConditions.has(cond.column)) {
        columnConditions.set(cond.column, []);
      }
      columnConditions.get(cond.column)!.push(cond);
    }

    for (const [column, conds] of columnConditions) {
      if (conds.length < 2) {
        continue;
      }

      const equals = conds.filter(c => c.operator === '=');
      const notEquals = conds.filter(c => c.operator === '!=' || c.operator === '<>');

      if (equals.length > 0 && notEquals.length > 0) {
        return { column };
      }

      if (equals.length >= 2) {
        const values = new Set(equals.map(c => c.value.toLowerCase()));
        if (values.size > 1) {
          return { column };
        }
      }

      const greaterThan = conds.filter(c => c.operator === '>');
      const lessThan = conds.filter(c => c.operator === '<');
      const greaterThanOrEqual = conds.filter(c => c.operator === '>=');
      const lessThanOrEqual = conds.filter(c => c.operator === '<=');

      if ((greaterThan.length > 0 || greaterThanOrEqual.length > 0) &&
          (lessThan.length > 0 || lessThanOrEqual.length > 0)) {
        const maxLower = Math.max(
          ...greaterThan.map(c => parseFloat(c.value)),
          ...greaterThanOrEqual.map(c => parseFloat(c.value))
        );
        const minUpper = Math.min(
          ...lessThan.map(c => parseFloat(c.value)),
          ...lessThanOrEqual.map(c => parseFloat(c.value))
        );

        if (isNaN(maxLower) || isNaN(minUpper) || maxLower >= minUpper) {
          return { column };
        }
      }
    }

    return null;
  }

  private flattenConditions(scope: ScopeGroupDto): Array<{ column: string; operator: string; value: string; negated: boolean }> {
    const result: Array<{ column: string; operator: string; value: string; negated: boolean }> = [];

    const processItems = (items: ScopeGroupItemDto[]) => {
      for (const item of items) {
        if ('logicalOperator' in item) {
          processItems(item.conditions);
        } else {
          let operator = item.operator.toUpperCase();
          let negated = false;

          if (operator === 'NOT LIKE') {
            operator = '!=';
            negated = true;
          } else if (operator === 'NOT IN') {
            operator = '!=';
            negated = true;
          }

          result.push({
            column: item.column.toLowerCase(),
            operator,
            value: item.value || '',
            negated,
          });
        }
      }
    };

    processItems(scope.conditions);
    return result;
  }

  private async checkParentConflict(
    groupId: number,
    childScope: ScopeGroupDto,
    targetTable: string,
    excludeRuleId?: number,
  ): Promise<{ column: string; parentValue: string; childValue: string } | null> {
    const parentGroup = await this.findParentGroup(groupId);
    if (!parentGroup) {
      return null;
    }

    const parentRules = await this.rlsRuleRepository.find({
      where: { groupId: parentGroup.id, targetTable },
      relations: ['conditionGroups', 'conditionGroups.conditions'],
    });

    for (const parentRule of parentRules) {
      if (excludeRuleId && parentRule.id === excludeRuleId) {
        continue;
      }

      const parentScope = await this.buildScopeFromRule(parentRule);
      if (!parentScope) continue;

      const conflict = this.checkChildConflict(parentScope, childScope, parentGroup.name);
      if (conflict) {
        return {
          column: conflict.column,
          parentValue: JSON.stringify(parentScope),
          childValue: JSON.stringify(childScope),
        };
      }
    }

    return null;
  }

  private checkChildConflict(
    parentScope: ScopeGroupDto,
    childScope: ScopeGroupDto,
    childGroupName: string,
  ): { column: string; message: string } | null {
    const parentColumnValues = this.extractColumnConditions(parentScope);
    const childColumnValues = this.extractColumnConditions(childScope);

    for (const [column, childValue] of Object.entries(childColumnValues)) {
      if (parentColumnValues[column]) {
        const parentValue = parentColumnValues[column];
        
        if (childValue.startsWith('<>') || childValue.startsWith('!=')) {
          return {
            column,
            message: `Child tries to exclude '${childValue}' but parent allows '${parentValue}'`,
          };
        }
      }
    }

    return null;
  }

  private extractColumnConditions(scope: ScopeGroupDto): Record<string, string> {
    const conditions: Record<string, string> = {};
    const flatConditions = this.flattenConditions(scope);

    for (const cond of flatConditions) {
      if (cond.operator === '=' || cond.operator === 'LIKE') {
        conditions[cond.column] = cond.value;
      }
    }

    return conditions;
  }

  private async findParentGroup(groupId: number): Promise<Group | null> {
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });

    if (group && group.parentId) {
      return this.groupRepository.findOne({
        where: { id: group.parentId },
      });
    }

    return null;
  }

  private async isDescendant(group: Group, ancestorId: number): Promise<boolean> {
    if (group.id === ancestorId) {
      return true;
    }

    if (!group.parentId) {
      return false;
    }

    const parentGroup = await this.groupRepository.findOne({
      where: { id: group.parentId },
    });

    if (!parentGroup) {
      return false;
    }

    return this.isDescendant(parentGroup, ancestorId);
  }
}