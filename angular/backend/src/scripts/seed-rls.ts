import { DataSource } from 'typeorm';
import { RlsRule } from '../modules/permissions/entities/rls-rule.entity';
import { RlsConditionGroup } from '../modules/permissions/entities/rls-condition-group.entity';
import { RlsRuleCondition } from '../modules/permissions/entities/rls-rule-condition.entity';
import { RlsSystemBypassService } from '../../packages/nestjs-typeorm-rls/src/internal/internal-bypass.service';
import { ClsService } from 'nestjs-cls';

interface BootstrapRule {
  targetTable: string;
  description: string;
}

const FUNDAMENTAL_RULES: BootstrapRule[] = [
  {
    targetTable: 'rls_rules',
    description: 'Allow system to read RLS rules for management',
  },
  {
    targetTable: 'rls_join_paths',
    description: 'Allow system to read join paths for query construction',
  },
  {
    targetTable: 'rls_join_conditions',
    description: 'Allow system to read join conditions',
  },
  {
    targetTable: 'rls_scope_templates',
    description: 'Allow system to read scope templates',
  },
];

async function bootstrap() {
  console.log('Starting RLS Bootstrap Seeding...');
  console.log('This script should be run ONCE after database migration.');
  console.log('It creates fundamental RLS rules to allow the system to function.\n');

  const dbPath = process.env.DATABASE_FILE || 'db.sqlite';
  console.log(`Using database: ${dbPath}`);

  const dataSource = new DataSource({
    type: 'sqlite',
    database: dbPath,
    synchronize: false,
    entities: [RlsRule, RlsConditionGroup, RlsRuleCondition],
  });

  await dataSource.initialize();
  console.log('Database connection established.\n');

  const mockCls = {
    runWith: async (context: any, callback: () => Promise<any>) => {
      return callback();
    },
  } as unknown as ClsService;

  const bypassService = new RlsSystemBypassService(mockCls);

  await bypassService.runSystemBypass(async () => {
    const ruleRepo = dataSource.getRepository(RlsRule);
    const groupRepo = dataSource.getRepository(RlsConditionGroup);
    const conditionRepo = dataSource.getRepository(RlsRuleCondition);

    for (const rule of FUNDAMENTAL_RULES) {
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

        console.log(`✓ Created rule: ${rule.description}`);
      } else {
        console.log(`○ Rule exists: ${rule.description}`);
      }
    }
  });

  console.log('\nRLS Bootstrap Seeding completed successfully!');
  await dataSource.destroy();
}

bootstrap().catch((error) => {
  console.error('Bootstrap seeding failed:', error);
  process.exit(1);
});