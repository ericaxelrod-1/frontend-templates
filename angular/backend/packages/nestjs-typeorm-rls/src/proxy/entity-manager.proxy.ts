import { EntityManager, SelectQueryBuilder, Repository, TreeRepository, EntityMetadata } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { RlsService } from '../rls.service';
import { RlsMetricsService } from '../rls-metrics.service';
import { RlsModuleOptions } from '../rls.module';
import { createQueryBuilderProxy } from './query-builder.proxy';

class RlsSecurityViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RlsSecurityViolationError';
  }
}

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

  // Helper to extract primary key value from entity
  const extractPrimaryKeyValue = (entity: any, metadata: EntityMetadata): any => {
    const primaryColumn = metadata.primaryColumns[0];
    if (!primaryColumn) return undefined;
    return entity[primaryColumn.propertyName];
  };

  // Helper to get tenant column value from entity
  const getTenantColumnValue = (entity: any): number | undefined => {
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
  // This prevents saving entities the user doesn't own
  manager.save = async function (target: any, entityOrOptions?: any, options?: any) {
    if (cls.get('__rlsBypass')) {
      return originalManager.save.call(originalManager, target, entityOrOptions, options);
    }

    // Handle both save(entity) and save(entity, options) signatures
    const entity = target;
    const entityOptions = entityOrOptions;

    if (!entity || typeof entity !== 'object') {
      return originalManager.save.call(originalManager, target, entityOrOptions, options);
    }

    try {
      const metadata = originalManager.connection.getMetadata(entity.constructor);
      
      if (isExemptTable(metadata.tableName)) {
        return originalManager.save.call(originalManager, target, entityOrOptions, options);
      }

      // Extract primary key - if this is a new entity (no ID), skip verification
      const primaryKeyValue = extractPrimaryKeyValue(entity, metadata);
      
      // If this is an INSERT (no primary key), the beforeInsert subscriber handles security
      // For UPDATE operations (has primary key), verify ownership first
      if (primaryKeyValue !== undefined && primaryKeyValue !== null) {
        // Try to find the existing entity using the proxied query builder
        const existingEntity = await manager.findOne(entity.constructor, {
          where: { [metadata.primaryColumns[0].propertyName]: primaryKeyValue } as any
        });

        // If RLS blocked the findOne (returns null but we expected a result), reject
        // This means the user doesn't own this record
        if (existingEntity === null) {
          // Entity was not found - either doesn't exist or RLS blocked it
          // We cannot distinguish between "doesn't exist" and "RLS blocked" without timing attacks
          // To be safe, reject the update
          metrics.recordBlock('save_without_ownership');
          throw new RlsSecurityViolationError(
            `RLS: Cannot update entity with ID ${primaryKeyValue}. ` +
            `Either the record does not exist or you do not have access to it.`
          );
        }

        // If entity exists and we found it, verify the tenant column matches
        const entityTenantId = getTenantColumnValue(entity);
        const existingTenantId = getTenantColumnValue(existingEntity);
        
        if (entityTenantId !== undefined && existingTenantId !== undefined) {
          if (entityTenantId !== existingTenantId) {
            metrics.recordBlock('tenant_mismatch');
            throw new RlsSecurityViolationError(
              `RLS: Tenant mismatch on update. ` +
              `Attempted to assign to group ${entityTenantId} but record belongs to group ${existingTenantId}.`
            );
          }
        }

        // If entity has a tenant column but we didn't find it via RLS-allowed query,
        // it means the user doesn't have access to modify this record
        if ((entityTenantId !== undefined || existingTenantId !== undefined) && 
            entityTenantId === undefined && existingTenantId !== undefined) {
          metrics.recordBlock('remove_tenant_column');
          throw new RlsSecurityViolationError(
            `RLS: Cannot remove tenant assignment from existing record. ` +
            `The record belongs to group ${existingTenantId} and you cannot change this.`
          );
        }
      }

      // All verifications passed - proceed with save
      return originalManager.save.call(originalManager, target, entityOrOptions, options);
    } catch (error) {
      if (error instanceof RlsSecurityViolationError) {
        throw error;
      }
      // For other errors (invalid entity, etc.), let TypeORM handle them
      return originalManager.save.call(originalManager, target, entityOrOptions, options);
    }
  };

  // 5. CRITICAL: Verify-Before-Mutate for remove()
  // This prevents deleting entities the user doesn't own
  manager.remove = async function (target: any, entityOrOptions?: any, options?: any) {
    if (cls.get('__rlsBypass')) {
      return originalManager.remove.call(originalManager, target, entityOrOptions, options);
    }

    // Handle both remove(entity) and remove(entities[]) signatures
    const entityOrEntities = target;

    if (!entityOrEntities || (Array.isArray(entityOrEntities) && entityOrEntities.length === 0)) {
      return originalManager.remove.call(originalManager, target, entityOrOptions, options);
    }

    const entities = Array.isArray(entityOrEntities) ? entityOrEntities : [entityOrEntities];

    try {
      for (const entity of entities) {
        if (typeof entity !== 'object') continue;

        const metadata = originalManager.connection.getMetadata(entity.constructor);
        
        if (isExemptTable(metadata.tableName)) {
          continue; // Exempt tables can be removed without verification
        }

        const primaryKeyValue = extractPrimaryKeyValue(entity, metadata);
        
        if (primaryKeyValue === undefined || primaryKeyValue === null) {
          // New entity without ID - nothing to verify
          continue;
        }

        // Verify ownership via proxied findOne
        const existingEntity = await manager.findOne(entity.constructor, {
          where: { [metadata.primaryColumns[0].propertyName]: primaryKeyValue } as any
        });

        if (existingEntity === null) {
          metrics.recordBlock('remove_without_ownership');
          throw new RlsSecurityViolationError(
            `RLS: Cannot remove entity with ID ${primaryKeyValue}. ` +
            `Either the record does not exist or you do not have access to it.`
          );
        }
      }

      // All verifications passed - proceed with remove
      return originalManager.remove.call(originalManager, target, entityOrOptions, options);
    } catch (error) {
      if (error instanceof RlsSecurityViolationError) {
        throw error;
      }
      // For other errors, let TypeORM handle them
      return originalManager.remove.call(originalManager, target, entityOrOptions, options);
    }
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
