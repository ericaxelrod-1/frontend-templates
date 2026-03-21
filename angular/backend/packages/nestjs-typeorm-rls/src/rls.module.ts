import { DynamicModule, Module, Global, Logger, Provider } from '@nestjs/common';
import { getEntityManagerToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { RlsService } from './rls.service';
import { RlsSystemBypassService } from './internal/internal-bypass.service';
import { RlsMetricsService } from './rls-metrics.service';
import { RlsInsertSubscriber } from './rls-subscriber';
import { createEntityManagerProxy } from './proxy/entity-manager.proxy';

export interface RlsModuleOptions {
  enabled?: boolean;
  connectionName?: string;
  systemTableAliases?: Record<string, string>;
  exemptTables?: string[];
  fallbackBehavior?: 'warn' | 'deny';
}

@Global()
@Module({})
export class RlsModule {
  private static readonly logger = new Logger('RlsModule');

  static forRootAsync(options: {
    imports?: any[];
    inject?: any[];
    connectionName?: string;
    useFactory: (...args: any[]) => RlsModuleOptions | Promise<RlsModuleOptions>;
  }): DynamicModule {
    const rlsOptionsProvider: Provider = {
      provide: 'RLS_CONFIG_OPTIONS',
      useFactory: options.useFactory,
      inject: options.inject || [],
    };

    const entityManagerProvider: Provider = {
      provide: getEntityManagerToken(options.connectionName),
      useFactory: async (
        dataSource: DataSource,
        cls: ClsService,
        rlsService: RlsService,
        metrics: RlsMetricsService,
        config: RlsModuleOptions,
      ) => {
        if (!config.enabled || process.argv.includes('migration:run')) {
          return dataSource.createEntityManager();
        }

        this.patchDataSourceQueryRunner(dataSource, cls, rlsService, metrics, config);

        const originalManager = dataSource.createEntityManager();
        return createEntityManagerProxy(originalManager, cls, rlsService, metrics, config);
      },
      inject: [DataSource, ClsService, RlsService, RlsMetricsService, 'RLS_CONFIG_OPTIONS'],
    };

    return {
      module: RlsModule,
      imports: options.imports || [],
      providers: [
        rlsOptionsProvider,
        RlsMetricsService,
        RlsService,
        RlsSystemBypassService,
        RlsInsertSubscriber,
        entityManagerProvider,
      ],
      exports: [
      RlsService,
      RlsSystemBypassService,
      RlsMetricsService,
      getEntityManagerToken(options.connectionName),
      'RLS_CONFIG_OPTIONS',
    ],
    };
  }

  private static patchDataSourceQueryRunner(
    dataSource: DataSource, 
    cls: ClsService, 
    rlsService: RlsService, 
    metrics: RlsMetricsService,
    config: RlsModuleOptions
  ) {
    if ((dataSource.createQueryRunner as any).__rlsPatched) return;

    const originalCreateRunner = dataSource.createQueryRunner.bind(dataSource);

    dataSource.createQueryRunner = (mode?: any) => {
      const qr = originalCreateRunner(mode);

      const crashIfNoBypass = (methodName: string) => {
        if (!cls.get('__rlsBypass')) {
          this.logger.error(`Security Violation: Direct QueryRunner.${methodName}() is forbidden outside a bypass block.`);
          throw new Error(`[RLS] Raw QueryRunner queries are strictly forbidden. Use QueryBuilder.`);
        }
      };

      const origQuery = qr.query.bind(qr);
      qr.query = (...args: any[]) => {
        crashIfNoBypass('query');
        return (origQuery as any)(...args);
      };

      if ((qr as any).rawQuery) {
        const origRawQuery = (qr as any).rawQuery.bind(qr);
        (qr as any).rawQuery = (...args: any[]) => {
          crashIfNoBypass('rawQuery');
          return (origRawQuery as any)(...args);
        };
      }

      // Secure the manager exposed on the query runner (e.g. during transactions)
      const originalManager = qr.manager;
      Object.defineProperty(qr, 'manager', {
         value: createEntityManagerProxy(originalManager, cls, rlsService, metrics, config),
         writable: false,
         configurable: true
      });

      return qr;
    };

    (dataSource.createQueryRunner as any).__rlsPatched = true;
  }
}
