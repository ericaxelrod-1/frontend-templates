import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface RlsRuleResult {
  sql: string;
  parameters?: Record<string, any>;
}

export interface RlsScope {
  groupId: number;
  sql: string;
  parameters?: Record<string, any>;
}

interface CachedRule {
  sql: string;
  parameters?: Record<string, any>;
  timestamp: number;
}

@Injectable()
export class RlsService {
  private readonly logger = new Logger(RlsService.name);
  private cache: Map<string, CachedRule> = new Map();
  private readonly CACHE_TTL_MS = 60000;
  private dataSource!: DataSource;

  setDataSource(ds: DataSource) {
    this.dataSource = ds;
  }

  private async getGroupDescendants(groupIds: number[]): Promise<number[]> {
    if (!groupIds || groupIds.length === 0) return [];
    if (!this.dataSource) return [];

    const placeholders = groupIds.map(() => '?').join(',');
    const descendants = await this.dataSource.query(
      `WITH RECURSIVE group_tree AS (
        SELECT id FROM "groups" WHERE id IN (${placeholders})
        UNION ALL
        SELECT g.id FROM "groups" g
        INNER JOIN group_tree gt ON g.parent_id = gt.id
      )
      SELECT DISTINCT id FROM group_tree`,
      groupIds,
    );

    return descendants.map((r: any) => r.id);
  }

  async getRulesForTable(
    tableName: string,
    groupIds: number[],
  ): Promise<RlsRuleResult | null> {
    if (!groupIds || groupIds.length === 0) {
      return null;
    }

    const cacheKey = `rules:${tableName}:${groupIds.sort().join(',')}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      this.logger.debug(`Cache hit for ${cacheKey}`);
      return { sql: cached.sql, parameters: cached.parameters };
    }

    const allGroupIds = await this.getGroupDescendants(groupIds);

    if (allGroupIds.length === 0) {
      return null;
    }

    const placeholders = allGroupIds.map(() => '?').join(',');
    const rules = await this.dataSource.query(
      `SELECT sql, parameters FROM rls_rules 
       WHERE group_id IN (${placeholders}) 
       AND target_table = ?`,
      [...allGroupIds, tableName],
    );

    if (!rules || rules.length === 0) {
      return null;
    }

    const combinedSqlParts: string[] = [];
    const combinedParams: Record<string, any> = {};
    let paramIndex = 0;

    for (const rule of rules) {
      const params = rule.parameters ? JSON.parse(rule.parameters) : {};
      for (const [key, value] of Object.entries(params)) {
        const namespacedKey = `rls_${paramIndex++}_${key}`;
        combinedParams[namespacedKey] = value;
        combinedSqlParts.push(rule.sql.replace(`:${key}\\b`, `:${namespacedKey}`));
      }
    }

    const result: RlsRuleResult = {
      sql: combinedSqlParts.join(' OR '),
      parameters: combinedParams,
    };

    this.cache.set(cacheKey, {
      sql: result.sql,
      parameters: result.parameters,
      timestamp: Date.now(),
    });

    this.logger.debug(`Fetched ${rules.length} rules for table ${tableName}`);
    return result;
  }

  async getScopesForTable(
    tableName: string,
    groupIds: number[],
  ): Promise<RlsScope[]> {
    if (!groupIds || groupIds.length === 0) {
      return [];
    }

    const allGroupIds = await this.getGroupDescendants(groupIds);

    if (allGroupIds.length === 0) {
      return [];
    }

    const placeholders = allGroupIds.map(() => '?').join(',');
    const rules = await this.dataSource.query(
      `SELECT r.group_id, r.sql, r.parameters FROM rls_rules r 
       WHERE r.group_id IN (${placeholders}) 
       AND r.target_table = ?`,
      [...allGroupIds, tableName],
    );

    return rules.map((rule: any) => ({
      groupId: rule.group_id,
      sql: rule.sql,
      parameters: rule.parameters ? JSON.parse(rule.parameters) : {},
    }));
  }

  getJoinPath(name: string): any {
    return null;
  }

  getAllJoinPaths(): any[] {
    return [];
  }

  getScopeTemplate(id: number): any {
    return null;
  }

  getAllScopeTemplates(): any[] {
    return [];
  }

  invalidateCache(tableName?: string): void {
    if (tableName) {
      for (const key of this.cache.keys()) {
        if (key.includes(`:${tableName}:`)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
    this.logger.debug(`Cache invalidated${tableName ? ` for table ${tableName}` : ''}`);
  }
}
