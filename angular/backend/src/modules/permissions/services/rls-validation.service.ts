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
      if (!childRule.group || !this.isDescendant(childRule.group, groupId)) {
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
    const columnPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|!=|<>|<|>|<=|>=|LIKE|IN)\s*/gi;
    const columns = new Set<string>();
    let match;

    while ((match = columnPattern.exec(sql)) !== null) {
      const col = match[1].toLowerCase();
      if (columns.has(col)) {
        return { column: col };
      }
      columns.add(col);
    }

    const notPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*<>\s*([^\s,)]+)/gi;
    while ((match = notPattern.exec(sql)) !== null) {
      const col = match[1].toLowerCase();
      if (columns.has(col)) {
        return { column: col };
      }
    }

    return null;
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

  private isDescendant(group: Group, ancestorId: number): boolean {
    if (group.id === ancestorId) {
      return true;
    }

    if (group.parentId === ancestorId) {
      return true;
    }

    return false;
  }
}
