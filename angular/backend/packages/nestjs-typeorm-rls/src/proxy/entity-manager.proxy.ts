import { EntityManager, SelectQueryBuilder, Repository, TreeRepository, EntityMetadata } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { RlsService } from '../rls.service';
import { RlsMetricsService } from '../rls-metrics.service';
import { RlsModuleOptions } from '../rls.module';
import { RlsSecurityViolationError } from '../errors';
import { createQueryBuilderProxy } from './query-builder.proxy';

export { RlsSecurityViolationError };

export function createEntityManagerProxy(
  originalManager: EntityManager,
  cls: ClsService,
  rlsService: RlsService,
  metrics: RlsMetricsService,
  config: RlsModuleOptions
): EntityManager {
  const manager = Object.create(originalManager);
  Object.assign(manager, originalManager);

  // Helper to check if table is exempt
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

  // Helper to extract primary key value(s) from entity for findOne criteria
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

    // Only return criteria if we have ALL parts of the composite key, 
    // OR if we have at least one key (which means it's an update attempt)
    // If it's completely missing, it's an insert.
    return hasAnyKey ? criteria : undefined;
  };

  // Helper to get tenant column value from entity
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

  // 1. Override createQueryBuilder
  manager.createQueryBuilder = function (...args: any[]) {
    const qb = originalManager.createQueryBuilder.apply(originalManager, args as any);
    return createQueryBuilderProxy(qb, cls, rlsService, metrics, config);
  };

  // 2. Override Repositories
  manager.getRepository = function (...args: any[]) {
    const repo = originalManager.getRepository.apply(originalManager, args as any);
    return repo.extend({ manager: manager });
  };

  manager.getTreeRepository = function (...args: any[]) {
    const repo = originalManager.getTreeRepository.apply(originalManager, args as any);
    return new TreeRepository(repo.target, manager, repo.queryRunner);
  };

  // 3. Intercept direct execution methods
  manager.update = async function (entityClass: any, criteria: any, partialEntity?: any) {
    if (cls.get('__rlsBypass')) {
      return originalManager.update.call(originalManager, entityClass, criteria, partialEntity);
    }

    if (isExemptTable(entityClass)) {
      return originalManager.update.call(originalManager, entityClass, criteria, partialEntity);
    }

    // TENANT SPOOFING PROTECTION (Update)
    // Check if the update payload tries to change the tenant ID to something unauthorized
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

  manager.delete = async function (entityClass: any, criteria: any) {
    if (cls.get('__rlsBypass')) {
      return originalManager.delete.call(originalManager, entityClass, criteria);
    }

    if (isExemptTable(entityClass)) {
      return originalManager.delete.call(originalManager, entityClass, criteria);
    }

    const qb = manager.createQueryBuilder().delete().from(entityClass).where(criteria);
    return qb.execute();
  };

  // 4. CRITICAL: Verify-Before-Mutate for save()
  // 
  // KNOWN LIMITATION (TOCTOU): This method performs ownership verification by:
  // 1. Fetching the existing record using the PROXIED manager (enforcing RLS)
  // 2. Delegating actual save to originalManager.save()
  //
  // Step 2 generates its own UPDATE SQL which bypasses the QueryBuilder proxy.
  // In horizontal scaling with multiple processes/connections, a race condition exists:
  // Between the ownership check and the actual save, another process could modify the record.
  // For SQLite (single-process), this is low risk. For multi-process deployments,
  // consider adding database-level constraints (e.g., CHECK constraints on tenant columns).
  //
  manager.save = async function (targetOrEntity: any, maybeEntityOrOptions?: any, maybeOptions?: any) {
    if (cls.get('__rlsBypass')) {
      return originalManager.save.call(originalManager, targetOrEntity, maybeEntityOrOptions, maybeOptions);
    }

    // Resolve what the actual entity is. TypeORM is very flexible here.
    let entityClass: any;
    let entityOrEntities: any;
    let options: any;

    if (typeof targetOrEntity === 'function' || typeof targetOrEntity === 'string') {
      entityClass = targetOrEntity;
      entityOrEntities = maybeEntityOrOptions;
      options = maybeOptions;
    } else {
      // If targetOrEntity is an array, we must derive the class from the first element
      if (Array.isArray(targetOrEntity) && targetOrEntity.length > 0) {
        entityClass = targetOrEntity[0].constructor;
      } else if (targetOrEntity && typeof targetOrEntity === 'object' && !Array.isArray(targetOrEntity)) {
        entityClass = targetOrEntity.constructor;
      }
      entityOrEntities = targetOrEntity;
      options = maybeEntityOrOptions;
    }

    if (!entityOrEntities || !entityClass || entityClass === Array || entityClass === Object) {
      // If we still can't figure out the class (e.g. they passed a raw object without a class definition), 
      // we must fail closed to prevent array bypasses.
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
      // If metadata fails, fail closed.
      throw new RlsSecurityViolationError(`RLS: Cannot verify save() operation. Metadata not found for ${entityClass}.`);
    }
    
    if (isExemptTable(metadata.tableName)) {
      return originalManager.save.call(originalManager, targetOrEntity, maybeEntityOrOptions, maybeOptions);
    }

    for (const entity of entities) {
      if (typeof entity !== 'object') continue;

      const pkCriteria = extractPrimaryKeyCriteria(entity, metadata);
      
      // If no PK criteria, it's an insert. 
      // If it's an insert, the beforeInsert subscriber will handle tenant assignment.
      // BUT if it has an explicit ID (e.g., predefined UUID), it will have PK criteria.
      if (pkCriteria) {
        // We must check if the entity *already exists*.
        // We use the UNPROXIED manager to check raw existence, to distinguish between
        // "record does not exist" (which means this is an insert with predefined ID)
        // and "record exists but user doesn't own it" (which is a violation).
        
        let existingRaw: any = null;
        try {
           existingRaw = await originalManager.findOne(entityClass, { where: pkCriteria as any });
        } catch (e) {
           // Ignore findOne errors
        }

        if (existingRaw) {
          // Record EXISTS in the database. This is an UPDATE.
          // Now verify the user actually owns it using the PROXIED manager.
          const existingSecured = await manager.findOne(entityClass, { where: pkCriteria as any });
          
          if (!existingSecured) {
             // Record exists, but user cannot see it!
             metrics.recordBlock('save_without_ownership');
             throw new RlsSecurityViolationError(
               `RLS: Cannot update entity. You do not have access to this record.`
             );
          }

          // Verify tenant column matches (no spoofing)
          const activeGroupIds = cls.get('activeGroupIds') || [];
          const entityTenantId = getTenantColumnValue(entity);
          const existingTenantId = getTenantColumnValue(existingSecured);
          
          if (entityTenantId !== undefined && existingTenantId !== undefined) {
            // They are providing a tenant ID, and one exists. Make sure they aren't changing it to something unauthorized.
            if (entityTenantId !== existingTenantId && !activeGroupIds.includes(entityTenantId)) {
              metrics.recordBlock('tenant_mismatch');
              throw new RlsSecurityViolationError(
                `RLS: Unauthorized attempt to change tenant ID.`
              );
            }
          }
          // Note: We removed the strict check for `entityTenantId === undefined && existingTenantId !== undefined`
          // because it broke partial updates where the payload omits the tenant ID.
        } else {
          // Record DOES NOT EXIST. This is an INSERT with a predefined ID.
          // We must manually enforce the tenant assignment here, because if they bypass
          // the subscriber, or if the subscriber misses it, we need defense in depth.
          const activeGroupIds = cls.get('activeGroupIds') || [];
          const primaryGroupId = cls.get('primaryGroupId');
          const effectiveGroupId = primaryGroupId ?? activeGroupIds[0];
          
          if (effectiveGroupId !== undefined) {
             const providedTenantId = getTenantColumnValue(entity);
             if (providedTenantId !== undefined) {
                // If they provided one, ensure they own it
                if (!activeGroupIds.includes(providedTenantId)) {
                   throw new RlsSecurityViolationError(`RLS: Tenant spoofing detected on insert.`);
                }
             } else {
                // Auto-assign
                // We rely on the beforeInsert subscriber to handle this cleanly, 
                // but we could enforce it here too.
             }
          }
        }
      }
    }

    return originalManager.save.call(originalManager, targetOrEntity, maybeEntityOrOptions, maybeOptions);
  };

  // 5. CRITICAL: Verify-Before-Mutate for remove()
  manager.remove = async function (targetOrEntity: any, maybeEntityOrOptions?: any, maybeOptions?: any) {
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
        // It might not exist, or they don't own it.
        // If it doesn't exist, remove() is a no-op anyway, but if they don't own it, we must block.
        // Let's check raw existence.
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

  // 6. Block Raw SQL
  manager.query = async function (...args: any[]) {
    if (!cls.get('__rlsBypass')) {
      metrics.recordBlock('raw_query');
      throw new Error(`[RLS] Raw EntityManager queries are strictly forbidden. Use QueryBuilder.`);
    }
    return originalManager.query.apply(originalManager, args as any);
  };

  // 7. Intercept Transactions
  manager.transaction = async function (...args: any[]) {
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

  return manager;
}
