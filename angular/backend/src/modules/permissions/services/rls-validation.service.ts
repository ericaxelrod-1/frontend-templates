import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RlsRule } from '../entities/rls-rule.entity';
import { Group } from '../entities/group.entity';

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
    sql: string,
    targetTable: string,
    existingRuleId?: number,
  ): Promise<ValidationResult> {
    const warnings: ValidationWarning[] = [];

    const selfConflict = this.checkSelfConflict(sql);
    if (selfConflict) {
      warnings.push({
        type: 'self_conflict',
        severity: 'error',
        message: 'Rule contradicts itself and will match 0 rows',
        details: { conflictingColumn: selfConflict.column },
      });
    }

    const parentConflict = await this.checkParentConflict(groupId, sql, targetTable, existingRuleId);
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
    newSql: string,
    targetTable: string,
  ): Promise<ValidationResult> {
    const warnings: ValidationWarning[] = [];

    const childRules = await this.rlsRuleRepository.find({
      where: { targetTable },
      relations: ['group'],
    });

    for (const childRule of childRules) {
      if (!childRule.group || !(await this.isDescendant(childRule.group, groupId))) {
        continue;
      }

      const conflict = this.checkChildConflict(newSql, childRule.sql, childRule.group.name);
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

  private checkSelfConflict(sql: string): { column: string } | null {
    // Parse conditions grouped by AND/OR to detect actual logical contradictions
    // Only flag: col = X AND col != X (or col = X AND col = Y where X != Y)
    // NOT flagged: col = X OR col = Y (valid multi-value IN clause)
    
    const conditions = this.parseConditions(sql);
    const columnConditions = new Map<string, Array<{ operator: string; value: string; negated: boolean }>>();

    for (const cond of conditions) {
      if (!columnConditions.has(cond.column)) {
        columnConditions.set(cond.column, []);
      }
      columnConditions.get(cond.column)!.push(cond);
    }

    // Check each column for contradictions
    for (const [column, conds] of columnConditions) {
      if (conds.length < 2) {
        continue; // Need at least 2 conditions on same column
      }

      // Check for equality contradictions: col = X AND col != X
      const equals = conds.filter(c => c.operator === '=');
      const notEquals = conds.filter(c => c.operator === '!=' || c.operator === '<>');

      if (equals.length > 0 && notEquals.length > 0) {
        return { column };
      }

      // Check for different equals: col = X AND col = Y where X != Y
      if (equals.length >= 2) {
        const values = new Set(equals.map(c => c.value.toLowerCase()));
        if (values.size > 1) {
          return { column }; // col = X AND col = Y with X != Y
        }
      }

      // Check for range contradictions: col > X AND col < X (or similar)
      const greaterThan = conds.filter(c => c.operator === '>');
      const lessThan = conds.filter(c => c.operator === '<');
      const greaterThanOrEqual = conds.filter(c => c.operator === '>=');
      const lessThanOrEqual = conds.filter(c => c.operator === '<=');

      if ((greaterThan.length > 0 || greaterThanOrEqual.length > 0) &&
          (lessThan.length > 0 || lessThanOrEqual.length > 0)) {
        // Check if ranges don't overlap
        const maxLower = Math.max(
          ...greaterThan.map(c => parseFloat(c.value)),
          ...greaterThanOrEqual.map(c => parseFloat(c.value))
        );
        const minUpper = Math.min(
          ...lessThan.map(c => parseFloat(c.value)),
          ...lessThanOrEqual.map(c => parseFloat(c.value))
        );

        if (isNaN(maxLower) || isNaN(minUpper) || maxLower >= minUpper) {
          return { column }; // Ranges don't overlap or are contradictory
        }
      }
    }

    return null;
  }

  private parseConditions(sql: string): Array<{ column: string; operator: string; value: string; negated: boolean }> {
    const conditions: Array<{ column: string; operator: string; value: string; negated: boolean }> = [];

    // Match column operators value patterns
    // Handles: col = 'value', col != 'value', col LIKE '%value%', col IN (a, b), etc.
    const pattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*(=|!=|<>|<|>|>=|<=|LIKE|NOT\s+LIKE|IN|NOT\s+IN)\s*\(?['"]?([^'"\s,)(]+)['"]?\)?/gi;
    let match;

    while ((match = pattern.exec(sql)) !== null) {
      const column = match[1].toLowerCase();
      let operator = match[2].toUpperCase();
      let value = match[3];
      let negated = false;

      // Normalize operator
      if (operator === 'NOT LIKE') {
        operator = '!=';
        negated = true;
      } else if (operator === 'NOT IN') {
        operator = '!=';
        negated = true;
      }

      // Skip array/list values (IN clauses with multiple values)
      if (operator === 'IN' && value.includes(',')) {
        continue;
      }

      conditions.push({ column, operator, value, negated });
    }

    return conditions;
  }

  private async checkParentConflict(
    groupId: number,
    childSql: string,
    targetTable: string,
    excludeRuleId?: number,
  ): Promise<{ column: string; parentValue: string; childValue: string } | null> {
    const parentGroup = await this.findParentGroup(groupId);
    if (!parentGroup) {
      return null;
    }

    const parentRules = await this.rlsRuleRepository.find({
      where: { groupId: parentGroup.id, targetTable },
    });

    for (const parentRule of parentRules) {
      if (excludeRuleId && parentRule.id === excludeRuleId) {
        continue;
      }

      const conflict = this.checkChildConflict(parentRule.sql, childSql, parentGroup.name);
      if (conflict) {
        return {
          column: conflict.column,
          parentValue: parentRule.sql,
          childValue: childSql,
        };
      }
    }

    return null;
  }

  private checkChildConflict(
    parentSql: string,
    childSql: string,
    childGroupName: string,
  ): { column: string; message: string } | null {
    const parentColumnValues = this.extractColumnConditions(parentSql);
    const childColumnValues = this.extractColumnConditions(childSql);

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

  private extractColumnConditions(sql: string): Record<string, string> {
    const conditions: Record<string, string> = {};

    const pattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|!=|LIKE)\s*['"]?([^'"\s,)]+)['"]?/gi;
    let match;

    while ((match = pattern.exec(sql)) !== null) {
      conditions[match[1].toLowerCase()] = match[2];
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
