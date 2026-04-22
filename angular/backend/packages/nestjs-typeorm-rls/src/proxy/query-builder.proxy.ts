import { SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { RlsService } from '../rls.service';
import { RlsMetricsService } from '../rls-metrics.service';
import { RlsModuleOptions } from '../rls.module';
import { generateUniqueKey } from '../internal/id-generator';

export function createQueryBuilderProxy<T extends ObjectLiteral>(
  originalQb: any,
  cls: ClsService,
  rlsService: RlsService,
  metrics: RlsMetricsService,
  config: RlsModuleOptions
): any {
  return new Proxy(originalQb, {
    get(target: any, prop: string | symbol) {
      const value = target[prop];

      if (typeof value !== 'function') {
        return value;
      }

      const joinMethods = [
        'leftJoin', 'innerJoin', 'leftJoinAndSelect', 'innerJoinAndSelect', 
        'rightJoin', 'fullJoin'
      ];
      
      if (typeof prop === 'string' && joinMethods.includes(prop)) {
        return function (entity: string | Function, alias: string, condition?: string, parameters?: any) {
          if (cls.get('__rlsBypass')) {
            return value.call(target, entity, alias, condition, parameters);
          }

          let resolvedTableName = '';
          try {
             if (typeof entity === 'function') {
                const metadata = target.connection.getMetadata(entity);
                resolvedTableName = metadata.tableName;
             } else if (typeof entity === 'string') {
                if (entity.includes('.')) {
                   const [parentAliasName, propertyName] = entity.split('.');
                   const parentAlias = target.expressionMap?.aliases.find((a: any) => a.name === parentAliasName);
                   if (parentAlias && parentAlias.metadata) {
                      const relation = parentAlias.metadata.relations.find((r: any) => r.propertyName === propertyName);
                      if (relation) {
                         resolvedTableName = relation.inverseEntityMetadata.tableName;
                      }
                   }
                } else {
                   const metadata = target.connection.getMetadata(entity);
                   resolvedTableName = metadata.tableName;
                }
             }
          } catch (e) {
             // Fallback to string if metadata lookup fails
             resolvedTableName = typeof entity === 'string' ? entity : '';
          }

          if (config.exemptTables?.includes(resolvedTableName)) {
            return value.call(target, entity, alias, condition, parameters);
          }

          // We defer join filtering to the execution phase because we might need to 
          // inject additional joins (Smart Injection)
          target.__rlsPendingJoins = target.__rlsPendingJoins || [];
          target.__rlsPendingJoins.push({
            resolvedTableName,
            alias,
            method: prop,
            entity,
            originalCondition: condition,
            originalParameters: parameters
          });

          // Return target to allow chaining, but DON'T call the original yet if we plan to mutate it later
          // Actually, we must call it to establish the alias in TypeORM's expression map
          return value.call(target, entity, alias, condition, parameters);
        };
      }

      const execMethods = [
        'getOne', 'getMany', 'getManyAndCount', 'getRawOne', 'getRawMany', 'stream', 'execute', 'insert'
      ];

      if (typeof prop === 'string' && execMethods.includes(prop)) {
        return async function (...args: any[]) {
          if (prop === 'insert' && !cls.get('__rlsBypass')) {
            throw new Error(`[RLS] Direct QueryBuilder inserts are forbidden. Use Repository.save() or EntityManager.save().`);
          }

          if (cls.get('__rlsBypass') || target.__rlsApplied) {
            return value.apply(target, args);
          }

          const groupIds = cls.get('activeGroupIds') || [];
          if (groupIds.length === 0 && config.fallbackBehavior === 'deny' && !isExempt(target, config)) {
             target.andWhere('1=0');
             target.__rlsApplied = true;
             return value.apply(target, args);
          }

          // 1. Process Main Table
          const mainTableName = target.expressionMap?.mainAlias?.metadata?.tableName;
          if (mainTableName && !config.exemptTables?.includes(mainTableName)) {
             const rlsRules = await rlsService.getRulesForTable(mainTableName, groupIds);
             if (rlsRules) {
                let sql = rlsRules.sql;
                const params = rlsRules.parameters || {};
                
                // Smart Join Injection
                const existingJoins = target.expressionMap?.joinAttributes.map((j: any) => ({
                   table: j.metadata?.tableName || j.entityOrProperty,
                   alias: j.alias.name
                })) || [];
                
                const joinResult = await rlsService.computeRequiredJoins(mainTableName, sql, existingJoins);
                for (const join of joinResult.joins) {
                   target.leftJoin(join.table, join.alias, `${join.alias}.${join.fromColumn} ${join.operator} ${join.toTable}.${join.toColumn}`);
                }

                const uniqueParams: Record<string, any> = {};
                for (const [key, val] of Object.entries(params)) {
                   const uniqueKey = generateUniqueKey(`rls_${key}`);
                   uniqueParams[uniqueKey] = val;
                   sql = sql.replace(new RegExp(`:${key}\\b`, 'g'), `:${uniqueKey}`);
                }
                target.andWhere(`(${sql})`, uniqueParams);
             } else if (config.fallbackBehavior === 'deny') {
                target.andWhere('1=0');
                metrics.recordBlock(mainTableName);
             }
          }

          // 2. Process Joined Tables
          // Note: We can't easily "modify" existing join conditions in TypeORM SelectQueryBuilder
          // after they are added. We have to use andWhere, but we must be careful about LEFT JOINs.
          // For true security, we apply andWhere. If it was a LEFT JOIN, it becomes effectively an INNER JOIN
          // which is the safer (though potentially restrictive) default for security.
          const pendingJoins = target.__rlsPendingJoins || [];
          for (const join of pendingJoins) {
             const rlsRules = await rlsService.getRulesForTable(join.resolvedTableName, groupIds);
             if (rlsRules) {
                let sql = rlsRules.sql;
                const params = rlsRules.parameters || {};
                
                const uniqueParams: Record<string, any> = {};
                for (const [key, val] of Object.entries(params)) {
                   const uniqueKey = generateUniqueKey(`rls_${key}`);
                   uniqueParams[uniqueKey] = val;
                   // Replace table names with aliases in the rule SQL
                   sql = sql.replace(new RegExp(`\\b${join.resolvedTableName}\\.`, 'g'), `${join.alias}.`);
                   sql = sql.replace(new RegExp(`:${key}\\b`, 'g'), `:${uniqueKey}`);
                }
                
                target.andWhere(`(${sql})`, uniqueParams);
             }
          }

          target.__rlsApplied = true;
          return value.apply(target, args);
        };
      }

      if (prop === 'subQuery') {
        return function() {
           const subQb = value.call(target);
           return createQueryBuilderProxy(subQb, cls, rlsService, metrics, config);
        };
      }

      return value.bind(target);
    }
  });
}

function isExempt(target: any, config: RlsModuleOptions): boolean {
   const mainTableName = target.expressionMap?.mainAlias?.metadata?.tableName;
   return !!(mainTableName && config.exemptTables?.includes(mainTableName));
}
