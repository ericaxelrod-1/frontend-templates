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
          const cachedRules = target.__rlsCachedRules || {};
          
          if (!cachedRules[resolvedTableName]) {
            cachedRules[resolvedTableName] = rlsService.getRulesForTable(resolvedTableName, groupIds);
            target.__rlsCachedRules = cachedRules;
          }

          target.__rlsPendingJoins = target.__rlsPendingJoins || [];
          target.__rlsPendingJoins.push({
            resolvedTableName,
            originalCondition: condition,
            originalParameters: parameters
          });

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

          if (cls.get('__rlsBypass')) {
            if (!target.__rlsBypassLogged) {
              metrics.recordBypass();
              target.__rlsBypassLogged = true;
            }
            return value.apply(target, args);
          }

          if (target.__rlsApplied) {
            return value.apply(target, args);
          }

          const cachedRules = target.__rlsCachedRules || {};
          
          for (const [tableName, rulesPromise] of Object.entries(cachedRules)) {
            const rlsRules = await rulesPromise as any;
            if (rlsRules) {
               const pendingJoin = target.__rlsPendingJoins?.find((j: any) => j.resolvedTableName === tableName);
               if (pendingJoin) {
                  let sql = rlsRules.sql;
                  const params = rlsRules.parameters || {};
                  
                  const uniqueParams: Record<string, any> = {};
                  for (const [key, val] of Object.entries(params)) {
                     const uniqueKey = generateUniqueKey(`rls_${key}`);
                     uniqueParams[uniqueKey] = val;
                     sql = sql.replace(new RegExp(`:${key}\\b`, 'g'), `:${uniqueKey}`);
                  }
                  
                  const securedCondition = pendingJoin.originalCondition 
                    ? `(${pendingJoin.originalCondition}) AND (${sql})`
                    : sql;
                  const mergedParameters = { ...pendingJoin.originalParameters, ...uniqueParams };
                  
                  target.andWhere(securedCondition, mergedParameters);
               }
            } else if (config.fallbackBehavior === 'deny') {
               metrics.recordBlock(tableName);
            }
          }

          const queryType = (target as any).expressionMap?.queryType;
           if (queryType === 'select' || queryType === 'update' || queryType === 'delete') {
              const mainTableName = (target as any).expressionMap?.mainAlias?.metadata?.tableName;
              
              if (mainTableName && !config.exemptTables?.includes(mainTableName)) {
                 if (!cachedRules[mainTableName]) {
                    const groupIds = cls.get('activeGroupIds') || [];
                    cachedRules[mainTableName] = rlsService.getRulesForTable(mainTableName, groupIds);
                 }
                 
                 const rlsRules = await cachedRules[mainTableName] as any;
                 
                 if (rlsRules) {
                    let sql = rlsRules.sql;
                    const params = rlsRules.parameters || {};
                    
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
                 } else {
                    console.warn(`[RLS WARNING] Table '${mainTableName}' is unprotected!`);
                 }
              }
           }

          target.__rlsApplied = true;
          target.__rlsCachedRules = {};
          target.__rlsPendingJoins = [];
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
