import { SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { RlsService } from '../rls.service';
import { RlsMetricsService } from '../rls-metrics.service';
import { RlsModuleOptions } from '../rls.module';

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
        return async function (entity: string | Function, alias: string, condition?: string, parameters?: any) {
          if (cls.get('__rlsBypass')) {
            metrics.recordBypass();
            return value.call(target, entity, alias, condition, parameters);
          }

          let resolvedTableName = '';
          try {
             const metadata = target.connection.getMetadata(entity);
             resolvedTableName = metadata.tableName;
          } catch (e) {
             if (typeof entity === 'string' && entity.includes('.')) {
                const [parentAliasName, propertyName] = entity.split('.');
                const parentAlias = target.expressionMap?.aliases.find((a: any) => a.name === parentAliasName);
                if (parentAlias && parentAlias.metadata) {
                   const relation = parentAlias.metadata.relations.find((r: any) => r.propertyName === propertyName);
                   if (relation) {
                      resolvedTableName = relation.inverseEntityMetadata.tableName;
                   }
                }
             }
          }

          if (!resolvedTableName) {
             console.warn(`[RLS] Could not resolve table name for entity '${entity}'. Blocking access.`);
             if (config.fallbackBehavior === 'deny') {
                return value.call(target, entity, alias, '1=0', parameters);
             }
          }

          if (config.exemptTables?.includes(resolvedTableName)) {
            return value.call(target, entity, alias, condition, parameters);
          }

          const groupIds = cls.get('activeGroupIds') || [];
          const rlsRules = await rlsService.getRulesForTable(resolvedTableName, groupIds);

          let securedCondition = condition;
          let mergedParameters = parameters || {};

          if (rlsRules) {
             let sql = rlsRules.sql;
             const params = rlsRules.parameters || {};
             
             // Namespace parameters
             const uniqueParams: Record<string, any> = {};
             for (const [key, val] of Object.entries(params)) {
                const uniqueKey = `rls_${key}_${Math.random().toString(36).substr(2, 9)}`;
                uniqueParams[uniqueKey] = val;
                sql = sql.replace(new RegExp(`:${key}\\b`, 'g'), `:${uniqueKey}`);
             }
             
             securedCondition = condition ? `(${condition}) AND (${sql})` : sql;
             mergedParameters = { ...mergedParameters, ...uniqueParams };
          } else if (config.fallbackBehavior === 'deny') {
             securedCondition = condition ? `(${condition}) AND (1=0)` : '1=0';
             metrics.recordBlock(resolvedTableName);
          } else {
             console.warn(`[RLS WARNING] Table '${resolvedTableName}' is unprotected!`);
          }

          return value.call(target, entity, alias, securedCondition, mergedParameters);
        };
      }

      const execMethods = [
        'getOne', 'getMany', 'getManyAndCount', 'getRawOne', 'getRawMany', 'stream', 'execute'
      ];

      if (typeof prop === 'string' && execMethods.includes(prop)) {
        return async function (...args: any[]) {
          if (cls.get('__rlsBypass')) {
            if (!target.__rlsBypassLogged) {
              metrics.recordBypass();
              target.__rlsBypassLogged = true;
            }
            return value.apply(target, args);
          }

          // Reset bypass logging flag for new queries
          target.__rlsBypassLogged = false;

          if (target.__rlsApplied) {
            return value.apply(target, args);
          }

          const queryType = (target as any).expressionMap?.queryType;
           if (queryType === 'select' || queryType === 'update' || queryType === 'delete') {
              const mainTableName = (target as any).expressionMap?.mainAlias?.metadata?.tableName;
              
              if (mainTableName && !config.exemptTables?.includes(mainTableName)) {
                 const groupIds = cls.get('activeGroupIds') || [];
                 const rlsRules = await rlsService.getRulesForTable(mainTableName, groupIds);
                 
                 if (rlsRules) {
                    let sql = rlsRules.sql;
                    const params = rlsRules.parameters || {};
                    
                    // Namespace parameters
                    const uniqueParams: Record<string, any> = {};
                    for (const [key, val] of Object.entries(params)) {
                       const uniqueKey = `rls_${key}_${Math.random().toString(36).substr(2, 9)}`;
                       uniqueParams[uniqueKey] = val;
                       sql = sql.replace(new RegExp(`:${key}\\b`, 'g'), `:${uniqueKey}`);
                    }

                    target.andWhere(`(${sql})`, uniqueParams);
                 } else if (config.fallbackBehavior === 'deny') {
                    target.andWhere('1=0');
                    metrics.recordBlock(mainTableName);
                 } else {
                    console.warn(`[RLS WARNING] Table '${mainTableName}' is unprotected!`);
                 }
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
