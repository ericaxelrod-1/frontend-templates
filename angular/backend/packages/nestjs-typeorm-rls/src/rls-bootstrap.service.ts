import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RlsSystemBypassService } from './internal/internal-bypass.service';

export interface RlsBootstrapRule {
  groupName: string;
  targetTable: string;
  sql: string;
  parameters?: Record<string, any>;
}

@Injectable()
export class RlsBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(RlsBootstrapService.name);

  constructor(
    // Bootstrap service intentionally bypasses CLS context
    // to seed fundamental RLS rules during initialization
    private readonly dataSource: DataSource,
    private readonly bypassService: RlsSystemBypassService,
  ) {}

  async onModuleInit() {
    await this.seedFundamentalRules();
  }

  /**
   * Seed fundamental RLS rules for core system tables.
   * These rules ensure that critical system operations work even before
   * administrators have configured custom RLS rules.
   * 
   * IMPORTANT: This MUST run inside runSystemBypass() to ensure the rules
   * are created without triggering RLS enforcement.
   */
  async seedFundamentalRules(): Promise<void> {
    const fundamentalRules: RlsBootstrapRule[] = [
      // Allow all groups to read their own RLS rules
      // This is needed for the admin UI to display rules
      {
        groupName: 'system',
        targetTable: 'rls_rules',
        sql: '1=1', // System-wide read access for rule management
      },
      // Allow all groups to read join paths
      {
        groupName: 'system',
        targetTable: 'rls_join_paths',
        sql: '1=1',
      },
      // Allow all groups to read join conditions
      {
        groupName: 'system',
        targetTable: 'rls_join_conditions',
        sql: '1=1',
      },
      // Allow all groups to read scope templates
      {
        groupName: 'system',
        targetTable: 'rls_scope_templates',
        sql: '1=1',
      },
    ];

    await this.bypassService.runSystemBypass(async () => {
      for (const rule of fundamentalRules) {
        await this.ensureRuleExists(rule);
      }
    });

    this.logger.log(`Seeded ${fundamentalRules.length} fundamental RLS rules`);
  }

  private async ensureRuleExists(rule: RlsBootstrapRule): Promise<void> {
    const repo = this.dataSource.getRepository('rls_rules');
    const existing = await repo.findOne({
      where: { groupId: 1, targetTable: rule.targetTable, sql: rule.sql },
    });

    if (!existing) {
      await repo.save(
        repo.create({
          groupId: 1,
          targetTable: rule.targetTable,
          sql: rule.sql,
          parameters: rule.parameters ? JSON.stringify(rule.parameters) : null,
        }),
      );
      this.logger.debug(`Created fundamental rule for ${rule.targetTable}`);
    }
  }

  /**
   * Bootstrap RLS for a specific table by creating a default "public" scope.
   * Call this during table creation to ensure the table is accessible.
   * 
   * @param tableName The table to bootstrap RLS for
   * @param whereClause The default WHERE clause (e.g., 'tenant_id = ?')
   */
  async bootstrapTableAccess(
    tableName: string,
    whereClause: string = '1=1',
    parameters?: Record<string, any>,
  ): Promise<void> {
    await this.bypassService.runSystemBypass(async () => {
      const repo = this.dataSource.getRepository('rls_rules');
      const existing = await repo.findOne({
        where: { groupId: 1, targetTable: tableName, sql: whereClause },
      });

      if (!existing) {
        await repo.save(
          repo.create({
            groupId: 1,
            targetTable: tableName,
            sql: whereClause,
            parameters: parameters ? JSON.stringify(parameters) : null,
          }),
        );
      }
    });
  }
}
