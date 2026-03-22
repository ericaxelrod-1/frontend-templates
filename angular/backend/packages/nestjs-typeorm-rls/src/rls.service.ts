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

export interface JoinCondition {
  id: number;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  operator: string;
}

export interface JoinPath {
  id: number;
  name: string;
  targetTable: string;
  chain: string[];
  conditions: JoinCondition[];
}

export interface RequiredJoin {
  table: string;
  alias: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  operator: string;
}

export interface JoinPathResult {
  joins: RequiredJoin[];
  missingTables: string[];
}

interface CachedRule {
  sql: string;
  parameters?: Record<string, any>;
  timestamp: number;
}

interface CachedJoinPath {
  paths: JoinPath[];
  timestamp: number;
}

@Injectable()
export class RlsService {
  private readonly logger = new Logger(RlsService.name);
  private cache: Map<string, CachedRule> = new Map();
  private joinPathCache: Map<string, CachedJoinPath> = new Map();
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
        combinedSqlParts.push(
          rule.sql.replace(`:${key}\\b`, `:${namespacedKey}`),
        );
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

  async getJoinPath(identifier: string | number): Promise<JoinPath | null> {
    if (!this.dataSource) {
      this.logger.warn('DataSource not set, cannot fetch join path');
      return null;
    }

    const isNumeric =
      typeof identifier === 'number' || /^\d+$/.test(String(identifier));
    const whereClause = isNumeric ? 'jp.id = ?' : 'jp.name = ?';
    const param = isNumeric ? Number(identifier) : identifier;

    const results = await this.dataSource.query(
      `SELECT 
        jp.id, jp.name, jp.target_table as "targetTable", jp.chain,
        jc.id as "conditionId", jc.from_table as "fromTable", 
        jc.from_column as "fromColumn", jc.to_table as "toTable", 
        jc.to_column as "toColumn", jc.operator
       FROM rls_join_paths jp
       LEFT JOIN rls_join_conditions jc ON jc.join_path_id = jp.id
       WHERE ${whereClause}`,
      [param],
    );

    if (!results || results.length === 0) {
      return null;
    }

    const first = results[0];
    const chain =
      typeof first.chain === 'string' ? JSON.parse(first.chain) : first.chain;

    const conditions: JoinCondition[] = results
      .filter((r: any) => r.conditionId)
      .map((r: any) => ({
        id: r.conditionId,
        fromTable: r.fromTable,
        fromColumn: r.fromColumn,
        toTable: r.toTable,
        toColumn: r.toColumn,
        operator: r.operator || '=',
      }));

    return {
      id: first.id,
      name: first.name,
      targetTable: first.targetTable,
      chain,
      conditions,
    };
  }

  async getAllJoinPaths(): Promise<JoinPath[]> {
    if (!this.dataSource) {
      this.logger.warn('DataSource not set, cannot fetch join paths');
      return [];
    }

    const cacheKey = 'all_join_paths';
    const cached = this.joinPathCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      this.logger.debug('Cache hit for all join paths');
      return cached.paths;
    }

    const results = await this.dataSource.query(
      `SELECT 
        jp.id, jp.name, jp.target_table as "targetTable", jp.chain,
        jc.id as "conditionId", jc.from_table as "fromTable", 
        jc.from_column as "fromColumn", jc.to_table as "toTable", 
        jc.to_column as "toColumn", jc.operator
       FROM rls_join_paths jp
       LEFT JOIN rls_join_conditions jc ON jc.join_path_id = jp.id
       ORDER BY jp.id, jc.id`,
    );

    const pathMap = new Map<number, JoinPath>();

    for (const row of results) {
      if (!pathMap.has(row.id)) {
        const chain =
          typeof row.chain === 'string' ? JSON.parse(row.chain) : row.chain;
        pathMap.set(row.id, {
          id: row.id,
          name: row.name,
          targetTable: row.targetTable,
          chain,
          conditions: [],
        });
      }

      if (row.conditionId) {
        pathMap.get(row.id)!.conditions.push({
          id: row.conditionId,
          fromTable: row.fromTable,
          fromColumn: row.fromColumn,
          toTable: row.toTable,
          toColumn: row.toColumn,
          operator: row.operator || '=',
        });
      }
    }

    const paths = Array.from(pathMap.values());
    this.joinPathCache.set(cacheKey, { paths, timestamp: Date.now() });
    this.logger.debug(`Fetched ${paths.length} join paths`);
    return paths;
  }

  async getJoinPathsForTable(tableName: string): Promise<JoinPath[]> {
    const allPaths = await this.getAllJoinPaths();
    return allPaths.filter((p) => p.targetTable === tableName);
  }

  private parseTableFromColumnRef(columnRef: string): string | null {
    const match = columnRef.match(/^(\w+)\.(\w+)$/);
    return match ? match[1] : null;
  }

  private findJoinPathForTables(
    paths: JoinPath[],
    targetTable: string,
    requiredTables: Set<string>,
  ): JoinPath | null {
    for (const path of paths) {
      if (path.targetTable !== targetTable) continue;

      const pathTables = new Set(path.chain);
      const hasAllRequired = Array.from(requiredTables).every((t) =>
        pathTables.has(t),
      );

      if (hasAllRequired) {
        return path;
      }
    }
    return null;
  }

  async computeRequiredJoins(
    tableName: string,
    ruleSql: string,
    existingJoins: { table: string; alias: string }[] = [],
  ): Promise<JoinPathResult> {
    const requiredTables = new Set<string>();
    const columnPattern = /(\w+)\.(\w+)/g;
    let match;

    while ((match = columnPattern.exec(ruleSql)) !== null) {
      const tableRef = match[1];
      if (
        tableRef !== tableName &&
        !['AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN'].includes(
          tableRef.toUpperCase(),
        )
      ) {
        if (
          !existingJoins.some(
            (j) => j.alias === tableRef || j.table === tableRef,
          )
        ) {
          requiredTables.add(tableRef);
        }
      }
    }

    if (requiredTables.size === 0) {
      return { joins: [], missingTables: [] };
    }

    const allPaths = await this.getAllJoinPaths();
    const joinPath = this.findJoinPathForTables(
      allPaths,
      tableName,
      requiredTables,
    );

    if (!joinPath) {
      return { joins: [], missingTables: Array.from(requiredTables) };
    }

    const existingAliasMap = new Map(
      existingJoins.map((j) => [j.table, j.alias]),
    );
    const usedAliases = new Set(existingJoins.map((j) => j.alias));

    const joins: RequiredJoin[] = [];
    const coveredTables = new Set([
      tableName,
      ...existingJoins.map((j) => j.table),
    ]);

    for (const condition of joinPath.conditions) {
      if (coveredTables.has(condition.toTable)) continue;

      let alias = existingAliasMap.get(condition.fromTable);
      if (!alias) {
        alias = this.generateUniqueAlias(condition.fromTable, usedAliases);
        usedAliases.add(alias);

        joins.push({
          table: condition.fromTable,
          alias,
          fromTable: condition.fromTable,
          fromColumn: condition.fromColumn,
          toTable: condition.toTable,
          toColumn: condition.toColumn,
          operator: condition.operator,
        });

        coveredTables.add(condition.fromTable);
      }
    }

    const stillMissing = Array.from(requiredTables).filter(
      (t) => !coveredTables.has(t),
    );

    return { joins, missingTables: stillMissing };
  }

  private generateUniqueAlias(
    baseName: string,
    usedAliases: Set<string>,
  ): string {
    let alias = baseName.replace(/[^a-zA-Z0-9]/g, '_');
    let counter = 1;

    while (usedAliases.has(alias)) {
      alias = `${baseName}_${counter++}`;
    }

    return alias;
  }

  buildJoinSql(joins: RequiredJoin[]): string {
    return joins
      .map(
        (j) =>
          ` JOIN ${j.table} ${j.alias} ON ${j.alias}.${j.fromColumn} ${j.operator} ${j.toTable}.${j.toColumn}`,
      )
      .join('\n');
  }

  // eslint-disable-next-line no-unused-vars
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
    this.joinPathCache.clear();
    this.logger.debug(
      `Cache invalidated${tableName ? ` for table ${tableName}` : ''}`,
    );
  }

  invalidateJoinPathCache(): void {
    this.joinPathCache.clear();
    this.logger.debug('Join path cache invalidated');
  }
}
