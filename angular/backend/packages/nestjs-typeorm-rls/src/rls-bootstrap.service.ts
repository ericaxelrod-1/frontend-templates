import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RlsSystemBypassService } from './internal/internal-bypass.service';

export interface RlsBootstrapRule {
  groupName: string;
  targetTable: string;
}

@Injectable()
export class RlsBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(RlsBootstrapService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly bypassService: RlsSystemBypassService,
  ) {}

  async onModuleInit() {
    await this.seedFundamentalRules();
  }

  async seedFundamentalRules(): Promise<void> {
    const fundamentalRules: RlsBootstrapRule[] = [
      { groupName: 'system', targetTable: 'rls_rules' },
      { groupName: 'system', targetTable: 'rls_join_paths' },
      { groupName: 'system', targetTable: 'rls_join_conditions' },
      { groupName: 'system', targetTable: 'rls_scope_templates' },
    ];

    await this.bypassService.runSystemBypass(async () => {
      const ruleRepo = this.dataSource.getRepository('rls_rules');
      const groupRepo = this.dataSource.getRepository('rls_condition_groups');
      const conditionRepo = this.dataSource.getRepository('rls_rule_conditions');

      for (const rule of fundamentalRules) {
        const existing = await ruleRepo.findOne({
          where: { groupId: 1, targetTable: rule.targetTable },
        });

        if (!existing) {
          const newRule = ruleRepo.create({
            groupId: 1,
            targetTable: rule.targetTable,
          });
          const savedRule = await ruleRepo.save(newRule);

          const rootGroup = groupRepo.create({
            ruleId: savedRule.id,
            logicalOperator: 'AND',
            sortOrder: 0,
          });
          const savedGroup = await groupRepo.save(rootGroup);

          const alwaysTrueCondition = conditionRepo.create({
            conditionGroupId: savedGroup.id,
            columnName: '1',
            operator: '=',
            value: '1',
            sortOrder: 0,
          });
          await conditionRepo.save(alwaysTrueCondition);

          savedRule.rootGroupId = savedGroup.id;
          await ruleRepo.save(savedRule);

          this.logger.debug(`Created fundamental rule for ${rule.targetTable}`);
        }
      }
    });

    this.logger.log(`Seeded ${fundamentalRules.length} fundamental RLS rules`);
  }

  async bootstrapTableAccess(
    tableName: string,
    whereClause: string = '1=1',
  ): Promise<void> {
    await this.bypassService.runSystemBypass(async () => {
      const ruleRepo = this.dataSource.getRepository('rls_rules');
      const groupRepo = this.dataSource.getRepository('rls_condition_groups');
      const conditionRepo = this.dataSource.getRepository('rls_rule_conditions');

      const existing = await ruleRepo.findOne({
        where: { groupId: 1, targetTable: tableName },
      });

      if (!existing) {
        const newRule = ruleRepo.create({
          groupId: 1,
          targetTable: tableName,
        });
        const savedRule = await ruleRepo.save(newRule);

        const rootGroup = groupRepo.create({
          ruleId: savedRule.id,
          logicalOperator: 'AND',
          sortOrder: 0,
        });
        const savedGroup = await groupRepo.save(rootGroup);

        const condition = conditionRepo.create({
          conditionGroupId: savedGroup.id,
          columnName: whereClause.split(' ')[0] || '1',
          operator: '=',
          value: '1',
          sortOrder: 0,
        });
        await conditionRepo.save(condition);

        savedRule.rootGroupId = savedGroup.id;
        await ruleRepo.save(savedRule);
      }
    });
  }
}
