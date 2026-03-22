import { EntityManager, SelectQueryBuilder, Repository, TreeRepository, EntityMetadata } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { RlsService } from '../rls.service';
import { RlsMetricsService } from '../rls-metrics.service';
import { RlsModuleOptions } from '../rls.module';
import { RlsSecurityViolationError } from '../errors';
import { createQueryBuilderProxy } from './query-builder.proxy';

export { RlsSecurityViolationError };

const SAFE_READ_METHODS = new Set([
  'find', 'findOne', 'findOneBy', 'findBy', 'findAndCount',
  'findAndCountBy', 'findOneOrFail', 'findOneByOrFail',
  'count', 'countBy', 'sum', 'average', 'minimum', 'maximum',
  'exists', 'existsBy',
  'getId', 'create', 'merge', 'preload', 'hasId',
]);

const PROXIED_METHODS = new Set([
  'createQueryBuilder', 'getRepository', 'getTreeRepository',
  'update', 'delete', 'save', 'remove', 'query', 'transaction',
]);

const SAFE_PROPERTIES = new Set([
  'connection', 'queryRunner', 'target',
]);

export function createEntityManagerProxy(
  originalManager: EntityManager,
  cls: ClsService,
  rlsService: RlsService,
  metrics: RlsMetricsService,
  config: RlsModuleOptions
): EntityManager {
  const manager = Object.create(originalManager);
  Object.assign(manager, originalManager);

  const isExemptTable = (entityClassOrName: any): boolean => {
    if (!entityClassOrName) return false;
    if (typeof entityClassOrName === 'string') {
      return config.exemptTables?.includes(entityClassOrName) || false;
    }
    try {
      const metadata = originalManager.connection.getMetadata(entityClassOrName);
      return config.exemptTables?.includes(metadata.tableName) || false;
    } catch {
      return false;
    }
  };

  const extractPrimaryKeyCriteria = (entity: any, metadata: EntityMetadata): Record<string, any> | undefined => {
    if (!metadata.primaryColumns || metadata.primaryColumns.length === 0) return undefined;
    
    const criteria: Record<string, any> = {};
    let hasAllKeys = true;
    let hasAnyKey = false;

    for (const col of metadata.primaryColumns) {
      const val = entity[col.propertyName];
      if (val !== undefined && val !== null) {
        criteria[col.propertyName] = val;
        hasAnyKey = true;
      } else {
        hasAllKeys = false;
      }
    }

    return hasAnyKey ? criteria : undefined;
  };

  const getTenantColumnValue = (entity: any): number | undefined => {
    if (!entity) return undefined;
    if ('groupId' in entity && typeof entity.groupId === 'number') {
      return entity.groupId;
    }
    if ('customer_id' in entity && typeof entity.customer_id === 'number') {
      return entity.customer_id;
    }
    if ('tenantId' in entity && typeof entity.tenantId === 'number') {
      return entity.tenantId;
    }
    if ('organizationId' in entity && typeof entity.organizationId === 'number') {
      return entity.organizationId;
    }
    return undefined;
  };

  const createOverriddenQueryBuilder = function (...args: any[]) {
    const qb = originalManager.createQueryBuilder.apply(originalManager, args as any);
    return createQueryBuilderProxy(qb, cls, rlsService, metrics, config);
  };

  const createOverriddenGetRepository = function (...args: any[]) {
    const repo = originalManager.getRepository.apply(originalManager, args as any);
    return repo.extend({ manager: manager });
  };

  const createOverriddenGetTreeRepository = function (...args: any[]) {
    const repo = originalManager.getTreeRepository.apply(originalManager, args as any);
    return new TreeRepository(repo.target, manager, repo.queryRunner);
  };

  const createOverriddenUpdate = async function (entityClass: any, criteria: any, partialEntity?: any) {
    if (cls.get('__rlsBypass')) {
      return originalManager.update.call(originalManager, entityClass, criteria, partialEntity);
    }

    if (isExemptTable(entityClass)) {
      return originalManager.update.call(originalManager, entityClass, criteria, partialEntity);
    }

    const activeGroupIds = cls.get('activeGroupIds') || [];
    const payloadTenantId = getTenantColumnValue(partialEntity);
    
    if (payloadTenantId !== undefined) {
      if (!activeGroupIds.includes(payloadTenantId)) {
        metrics.recordBlock('update_tenant_spoofing');
        throw new RlsSecurityViolationError(`RLS: Unauthorized attempt to change tenant ID via update().`);
      }
    }

    const qb = manager.createQueryBuilder().update(entityClass).set(partialEntity).where(criteria);
    return qb.execute();
  };

  const createOverriddenDelete = async function (entityClass: any, criteria: any) {
    if (cls.get('__rlsBypass')) {
      return originalManager.delete.call(originalManager, entityClass, criteria);
    }

    if (isExemptTable(entityClass)) {
      return originalManager.delete.call(originalManager, entityClass, criteria);
    }

    const qb = manager.createQueryBuilder().delete().from(entityClass).where(criteria);
    return qb.execute();
  };

  const createOverriddenSave = async function (targetOrEntity: any, maybeEntityOrOptions?: any, maybeOptions?: any) {
    if (cls.get('__rlsBypass')) {
      return originalManager.save.call(originalManager, targetOrEntity, maybeEntityOrOptions, maybeOptions);
    }

    let entityClass: any;
    let entityOrEntities: any;
    let options: any;

    if (typeof targetOrEntity === 'function' || typeof targetOrEntity === 'string') {
      entityClass = targetOrEntity;
      entityOrEntities = maybeEntityOrOptions;
      options = maybeOptions;
    } else {
      if (Array.isArray(targetOrEntity) && targetOrEntity.length > 0) {
        entityClass = targetOrEntity[0].constructor;
      } else if (targetOrEntity && typeof targetOrEntity === 'object' && !Array.isArray(targetOrEntity)) {
        entityClass = targetOrEntity.constructor;
      }
      entityOrEntities = targetOrEntity;
      options = maybeEntityOrOptions;
    }

    if (!entityOrEntities || !entityClass || entityClass === Array || entityClass === Object) {
      throw new RlsSecurityViolationError('RLS: Cannot verify save() operation. Entity class could not be determined.');
    }

    const entities = Array.isArray(entityOrEntities) ? entityOrEntities : [entityOrEntities];
    if (entities.length === 0) {
      return originalManager.save.call(originalManager, targetOrEntity, maybeEntityOrOptions, maybeOptions);
    }
    
    let metadata: EntityMetadata;
    try {
      metadata = originalManager.connection.getMetadata(entityClass);
    } catch (e) {
      throw new RlsSecurityViolationError(`RLS: Cannot verify save() operation. Metadata not found for ${entityClass}.`);
    }
    
    if (isExemptTable(metadata.tableName)) {
      return originalManager.save.call(originalManager, targetOrEntity, maybeEntityOrOptions, maybeOptions);
    }

    for (const entity of entities) {
      if (typeof entity !== 'object') continue;

      const pkCriteria = extractPrimaryKeyCriteria(entity, metadata);
      
      if (pkCriteria) {
        let existingRaw: any = null;
        try {
           existingRaw = await originalManager.findOne(entityClass, { where: pkCriteria as any });
        } catch (e) {
        }

        if (existingRaw) {
          const existingSecured = await manager.findOne(entityClass, { where: pkCriteria as any });
          
          if (!existingSecured) {
             metrics.recordBlock('save_without_ownership');
             throw new RlsSecurityViolationError(
               `RLS: Cannot update entity. You do not have access to this record.`
             );
          }

          const activeGroupIds = cls.get('activeGroupIds') || [];
          const entityTenantId = getTenantColumnValue(entity);
          const existingTenantId = getTenantColumnValue(existingSecured);
          
          if (entityTenantId !== undefined && existingTenantId !== undefined) {
            if (entityTenantId !== existingTenantId && !activeGroupIds.includes(entityTenantId)) {
              metrics.recordBlock('tenant_mismatch');
              throw new RlsSecurityViolationError(
                `RLS: Unauthorized attempt to change tenant ID.`
              );
            }
          }
        } else {
          const activeGroupIds = cls.get('activeGroupIds') || [];
          const primaryGroupId = cls.get('primaryGroupId');
          const effectiveGroupId = primaryGroupId ?? activeGroupIds[0];
          
          if (effectiveGroupId !== undefined) {
             const providedTenantId = getTenantColumnValue(entity);
             if (providedTenantId !== undefined) {
                if (!activeGroupIds.includes(providedTenantId)) {
                   throw new RlsSecurityViolationError(`RLS: Tenant spoofing detected on insert.`);
                }
             }
          }
        }
      }
    }

    return originalManager.save.call(originalManager, targetOrEntity, maybeEntityOrOptions, maybeOptions);
  };

  const createOverriddenRemove = async function (targetOrEntity: any, maybeEntityOrOptions?: any, maybeOptions?: any) {
    if (cls.get('__rlsBypass')) {
      return originalManager.remove.call(originalManager, targetOrEntity, maybeEntityOrOptions, maybeOptions);
    }

    let entityClass: any;
    let entityOrEntities: any;
    let options: any;

    if (typeof targetOrEntity === 'function' || typeof targetOrEntity === 'string') {
      entityClass = targetOrEntity;
      entityOrEntities = maybeEntityOrOptions;
      options = maybeOptions;
    } else {
      if (Array.isArray(targetOrEntity) && targetOrEntity.length > 0) {
        entityClass = targetOrEntity[0].constructor;
      } else if (targetOrEntity && typeof targetOrEntity === 'object' && !Array.isArray(targetOrEntity)) {
        entityClass = targetOrEntity.constructor;
      }
      entityOrEntities = targetOrEntity;
      options = maybeEntityOrOptions;
    }

    if (!entityOrEntities || !entityClass || entityClass === Array || entityClass === Object) {
      throw new RlsSecurityViolationError('RLS: Cannot verify remove() operation. Entity class could not be determined.');
    }

    const entities = Array.isArray(entityOrEntities) ? entityOrEntities : [entityOrEntities];
    if (entities.length === 0) {
      return originalManager.remove.call(originalManager, targetOrEntity, maybeEntityOrOptions, maybeOptions);
    }

    let metadata: EntityMetadata;
    try {
      metadata = originalManager.connection.getMetadata(entityClass);
    } catch (e) {
      throw new RlsSecurityViolationError(`RLS: Cannot verify remove() operation. Metadata not found for ${entityClass}.`);
    }
    
    if (isExemptTable(metadata.tableName)) {
      return originalManager.remove.call(originalManager, targetOrEntity, maybeEntityOrOptions, maybeOptions);
    }

    for (const entity of entities) {
      if (typeof entity !== 'object') continue;

      const pkCriteria = extractPrimaryKeyCriteria(entity, metadata);
      
      if (!pkCriteria) continue;

      const existingEntity = await manager.findOne(entityClass, {
        where: pkCriteria as any
      });

      if (existingEntity === null) {
        const existingRaw = await originalManager.findOne(entityClass, { where: pkCriteria as any });
        if (existingRaw) {
           metrics.recordBlock('remove_without_ownership');
           throw new RlsSecurityViolationError(
             `RLS: Cannot remove entity. You do not have access to it.`
           );
        }
      }
    }

    return originalManager.remove.call(originalManager, targetOrEntity, maybeEntityOrOptions, maybeOptions);
  };

  const createOverriddenQuery = async function (...args: any[]) {
    if (!cls.get('__rlsBypass')) {
      metrics.recordBlock('raw_query');
      throw new Error(`[RLS] Raw EntityManager queries are strictly forbidden. Use QueryBuilder.`);
    }
    return originalManager.query.apply(originalManager, args as any);
  };

  const createOverriddenTransaction = async function (...args: any[]) {
    const lastArg = args[args.length - 1];
    if (typeof lastArg === 'function') {
      const wrappedCallback = async (transactionalEntityManager: EntityManager) => {
        const proxiedTxManager = createEntityManagerProxy(transactionalEntityManager, cls, rlsService, metrics, config);
        return lastArg(proxiedTxManager);
      };
      args[args.length - 1] = wrappedCallback;
    }
    return originalManager.transaction.apply(originalManager, args as any);
  };

  manager.createQueryBuilder = createOverriddenQueryBuilder;
  manager.getRepository = createOverriddenGetRepository;
  manager.getTreeRepository = createOverriddenGetTreeRepository;
  manager.update = createOverriddenUpdate;
  manager.delete = createOverriddenDelete;
  manager.save = createOverriddenSave;
  manager.remove = createOverriddenRemove;
  manager.query = createOverriddenQuery;
  manager.transaction = createOverriddenTransaction;

  return new Proxy(manager, {
    get(target, prop) {
      if (PROXIED_METHODS.has(prop as string)) {
        return (target as any)[prop];
      }

      if (SAFE_READ_METHODS.has(prop as string)) {
        return (target as any)[prop]?.bind(target);
      }

      const value = (target as any)[prop];

      if (SAFE_PROPERTIES.has(prop as string)) {
        return value;
      }

      if (typeof value === 'function' && !PROXIED_METHODS.has(prop as string) && !SAFE_READ_METHODS.has(prop as string)) {
        throw new RlsSecurityViolationError(`Unrecognized EntityManager method: ${String(prop)}`);
      }

      return value;
    }
  });
}
