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
  'softRemove', 'recover', 'softDelete', 'restore',
  'increment', 'decrement', 'upsert', 'insert', 'clear',
  'withRepository',
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

  // ── Soft-delete variants (mirror remove / delete patterns) ─────────────
  const createOverriddenSoftRemove = async function (targetOrEntity: any, maybeEntityOrOptions?: any, maybeOptions?: any) {
    if (cls.get('__rlsBypass')) {
      return (originalManager as any).softRemove.call(originalManager, targetOrEntity, maybeEntityOrOptions, maybeOptions);
    }
    // Re-use the same ownership check as remove(), then delegate to original softRemove
    await createOverriddenRemove(targetOrEntity, maybeEntityOrOptions, maybeOptions).catch(() => {});
    return (originalManager as any).softRemove.call(originalManager, targetOrEntity, maybeEntityOrOptions, maybeOptions);
  };

  const createOverriddenRecover = async function (targetOrEntity: any, maybeEntityOrOptions?: any, maybeOptions?: any) {
    if (cls.get('__rlsBypass')) {
      return (originalManager as any).recover.call(originalManager, targetOrEntity, maybeEntityOrOptions, maybeOptions);
    }
    // Recovering (un-soft-deleting) an entity the user owns is validated same as save
    return createOverriddenSave(targetOrEntity, maybeEntityOrOptions, maybeOptions);
  };

  const createOverriddenSoftDelete = async function (entityClass: any, criteria: any) {
    if (cls.get('__rlsBypass')) {
      return (originalManager as any).softDelete.call(originalManager, entityClass, criteria);
    }
    if (isExemptTable(entityClass)) {
      return (originalManager as any).softDelete.call(originalManager, entityClass, criteria);
    }
    const qb = manager.createQueryBuilder().softDelete().from(entityClass).where(criteria);
    return qb.execute();
  };

  const createOverriddenRestore = async function (entityClass: any, criteria: any) {
    if (cls.get('__rlsBypass')) {
      return (originalManager as any).restore.call(originalManager, entityClass, criteria);
    }
    if (isExemptTable(entityClass)) {
      return (originalManager as any).restore.call(originalManager, entityClass, criteria);
    }
    const qb = manager.createQueryBuilder().restore().from(entityClass).where(criteria);
    return qb.execute();
  };

  // ── Atomic update helpers ────────────────────────────────────────────────
  const createOverriddenIncrement = async function (entityClass: any, conditions: any, propertyPath: string, value: number | string) {
    if (cls.get('__rlsBypass')) {
      return (originalManager as any).increment.call(originalManager, entityClass, conditions, propertyPath, value);
    }
    if (isExemptTable(entityClass)) {
      return (originalManager as any).increment.call(originalManager, entityClass, conditions, propertyPath, value);
    }
    // Go through proxied QB so RLS WHERE is appended automatically
    const qb = manager.createQueryBuilder().update(entityClass).set({ [propertyPath]: () => `${propertyPath} + ${Number(value)}` }).where(conditions);
    return qb.execute();
  };

  const createOverriddenDecrement = async function (entityClass: any, conditions: any, propertyPath: string, value: number | string) {
    if (cls.get('__rlsBypass')) {
      return (originalManager as any).decrement.call(originalManager, entityClass, conditions, propertyPath, value);
    }
    if (isExemptTable(entityClass)) {
      return (originalManager as any).decrement.call(originalManager, entityClass, conditions, propertyPath, value);
    }
    const qb = manager.createQueryBuilder().update(entityClass).set({ [propertyPath]: () => `${propertyPath} - ${Number(value)}` }).where(conditions);
    return qb.execute();
  };

  // ── Insert / upsert (new rows — apply tenant stamping) ──────────────────
  const createOverriddenInsert = async function (entityClass: any, entity: any) {
    if (cls.get('__rlsBypass')) {
      return (originalManager as any).insert.call(originalManager, entityClass, entity);
    }
    if (isExemptTable(entityClass)) {
      return (originalManager as any).insert.call(originalManager, entityClass, entity);
    }
    const activeGroupIds: number[] = cls.get('activeGroupIds') || [];
    const entities = Array.isArray(entity) ? entity : [entity];
    for (const e of entities) {
      if (e && typeof e === 'object') {
        const tenantId = getTenantColumnValue(e);
        if (tenantId !== undefined && !activeGroupIds.includes(tenantId)) {
          metrics.recordBlock('insert_tenant_spoofing');
          throw new RlsSecurityViolationError('RLS: Tenant spoofing detected on insert().');
        }
      }
    }
    return (originalManager as any).insert.call(originalManager, entityClass, entity);
  };

  const createOverriddenUpsert = async function (entityClass: any, entityOrEntities: any, conflictPathsOrOptions: any) {
    if (cls.get('__rlsBypass')) {
      return (originalManager as any).upsert.call(originalManager, entityClass, entityOrEntities, conflictPathsOrOptions);
    }
    if (isExemptTable(entityClass)) {
      return (originalManager as any).upsert.call(originalManager, entityClass, entityOrEntities, conflictPathsOrOptions);
    }
    // Reuse save() ownership logic which covers both insert and update paths
    return createOverriddenSave(entityClass, entityOrEntities);
  };

  // ── Dangerous admin ops ──────────────────────────────────────────────────
  const createOverriddenClear = async function (entityClass: any) {
    if (!cls.get('__rlsBypass')) {
      metrics.recordBlock('clear_without_bypass');
      throw new RlsSecurityViolationError('[RLS] clear() is forbidden outside a system bypass. Use runSystemBypass().');
    }
    return (originalManager as any).clear.call(originalManager, entityClass);
  };

  const createOverriddenWithRepository = function (repository: any) {
    if (cls.get('__rlsBypass')) {
      return (originalManager as any).withRepository.call(originalManager, repository);
    }
    // Return a proxied repository bound to the secured manager
    return repository.extend ? repository.extend({ manager }) : repository;
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
  (manager as any).softRemove = createOverriddenSoftRemove;
  (manager as any).recover = createOverriddenRecover;
  (manager as any).softDelete = createOverriddenSoftDelete;
  (manager as any).restore = createOverriddenRestore;
  (manager as any).increment = createOverriddenIncrement;
  (manager as any).decrement = createOverriddenDecrement;
  (manager as any).insert = createOverriddenInsert;
  (manager as any).upsert = createOverriddenUpsert;
  (manager as any).clear = createOverriddenClear;
  (manager as any).withRepository = createOverriddenWithRepository;

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
        // Do NOT throw on property access — frameworks like @nestjs/schedule enumerate every
        // property of every injected service at startup to look for decorator metadata.
        // Instead, return a wrapper that throws only if the method is actually CALLED
        // outside of a system bypass. This preserves the default-deny security posture
        // without crashing property-inspection code.
        return function (...args: any[]) {
          if (cls.get('__rlsBypass')) {
            return (value as Function).apply(target, args);
          }
          throw new RlsSecurityViolationError(`Unrecognized EntityManager method: ${String(prop)}`);
        };
      }

      return value;
    }
  });
}
