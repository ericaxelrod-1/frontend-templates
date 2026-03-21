import { EntityManager, SelectQueryBuilder, Repository, TreeRepository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { RlsService } from '../rls.service';
import { RlsMetricsService } from '../rls-metrics.service';
import { RlsModuleOptions } from '../rls.module';
import { createQueryBuilderProxy } from './query-builder.proxy';

export function createEntityManagerProxy(
  originalManager: EntityManager,
  cls: ClsService,
  rlsService: RlsService,
  metrics: RlsMetricsService,
  config: RlsModuleOptions
): EntityManager {
  // Clone the manager to avoid polluting the global singleton
  const manager = Object.create(originalManager);
  Object.assign(manager, originalManager);

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

    const metadata = originalManager.connection.getMetadata(entityClass);
    if (config.exemptTables?.includes(metadata.tableName)) {
      return originalManager.update.call(originalManager, entityClass, criteria, partialEntity);
    }

    const qb = manager.createQueryBuilder().update(entityClass).set(partialEntity).where(criteria);
    return qb.execute();
  };

  manager.delete = async function (entityClass: any, criteria: any) {
    if (cls.get('__rlsBypass')) {
      return originalManager.delete.call(originalManager, entityClass, criteria);
    }

    const metadata = originalManager.connection.getMetadata(entityClass);
    if (config.exemptTables?.includes(metadata.tableName)) {
      return originalManager.delete.call(originalManager, entityClass, criteria);
    }

    const qb = manager.createQueryBuilder().delete().from(entityClass).where(criteria);
    return qb.execute();
  };

  // 4. Block Raw SQL
  manager.query = async function (...args: any[]) {
    if (!cls.get('__rlsBypass')) {
      metrics.recordBlock('raw_query');
      throw new Error(`[RLS] Raw EntityManager queries are strictly forbidden. Use QueryBuilder.`);
    }
    return originalManager.query.apply(originalManager, args as any);
  };

  // 5. Intercept Transactions
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
