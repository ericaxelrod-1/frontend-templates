import { Injectable } from '@nestjs/common';
import { RlsConditionGroup } from '../entities/rls-condition-group.entity';
import { RlsRuleCondition } from '../entities/rls-rule-condition.entity';

@Injectable()
export class ScopeCompilerService {
  compileGroup(group: RlsConditionGroup, paramPrefix: string = 'p'): { sql: string; parameters: Record<string, any> } {
    const parts: string[] = [];
    const params: Record<string, any> = {};
    let idx = 0;
    
    for (const condition of group.conditions) {
      const paramName = `${paramPrefix}_${idx++}`;
      
      // Handle IS NULL, IS NOT NULL (no parameter needed)
      if (['IS NULL', 'IS NOT NULL'].includes(condition.operator.toUpperCase())) {
        parts.push(`${condition.columnName} ${condition.operator}`);
      } else if (condition.operator.toUpperCase() === 'IN') {
        // Split comma-separated values into individual params
        const values = condition.value.split(',').map(v => v.trim());
        const placeholders = values.map((_, i) => `:${paramName}_${i}`).join(', ');
        parts.push(`${condition.columnName} IN (${placeholders})`);
        values.forEach((v, i) => params[`${paramName}_${i}`] = v);
      } else {
        parts.push(`${condition.columnName} ${condition.operator} :${paramName}`);
        params[paramName] = condition.value;
      }
    }
    
    // Recurse into child groups
    for (const childGroup of group.childGroups) {
      const child = this.compileGroup(childGroup, `${paramPrefix}_g${idx++}`);
      parts.push(`(${child.sql})`);
      Object.assign(params, child.parameters);
    }
    
    return {
      sql: parts.join(` ${group.logicalOperator} `),
      parameters: params,
    };
  }
  
  // Add a method to compile from the raw database structure (tree of objects)
  compileFromTree(rootGroup: any, paramPrefix: string = 'p'): { sql: string; parameters: Record<string, any> } {
    return this.compileGroupRecursive(rootGroup, paramPrefix);
  }
  
  private compileGroupRecursive(group: any, paramPrefix: string): { sql: string; parameters: Record<string, any> } {
    const parts: string[] = [];
    const params: Record<string, any> = {};
    let idx = 0;
    
    const conditions = group.conditions || [];
    const childGroups = group.childGroups || [];
    const logicalOperator = group.logicalOperator || 'AND';
    
    for (const condition of conditions) {
      const paramName = `${paramPrefix}_${idx++}`;
      
      if (['IS NULL', 'IS NOT NULL'].includes(condition.operator?.toUpperCase())) {
        parts.push(`${condition.columnName} ${condition.operator}`);
      } else if (condition.operator?.toUpperCase() === 'IN') {
        const values = (condition.value || '').split(',').map(v => v.trim()).filter(v => v);
        if (values.length > 0) {
          const placeholders = values.map((_, i) => `:${paramName}_${i}`).join(', ');
          parts.push(`${condition.columnName} IN (${placeholders})`);
          values.forEach((v, i) => params[`${paramName}_${i}`] = v);
        }
      } else if (condition.operator && condition.columnName) {
        parts.push(`${condition.columnName} ${condition.operator} :${paramName}`);
        params[paramName] = condition.value;
      }
    }
    
    for (const childGroup of childGroups) {
      const child = this.compileGroupRecursive(childGroup, `${paramPrefix}_g${idx++}`);
      if (child.sql) {
        parts.push(`(${child.sql})`);
        Object.assign(params, child.parameters);
      }
    }
    
    return {
      sql: parts.join(` ${logicalOperator} `),
      parameters: params,
    };
  }
}
