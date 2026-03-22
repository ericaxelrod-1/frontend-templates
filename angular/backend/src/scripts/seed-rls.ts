import { DataSource } from 'typeorm';
import { RlsSystemBypassService } from '../../packages/nestjs-typeorm-rls/src/internal/internal-bypass.service';
import { ClsService } from 'nestjs-cls';

interface BootstrapRule {
  targetTable: string;
  sql: string;
  description: string;
}

const FUNDAMENTAL_RULES: BootstrapRule[] = [
  {
    targetTable: 'rls_rules',
    sql: '1=1',
    description: 'Allow system to read RLS rules for management',
  },
  {
    targetTable: 'rls_join_paths',
    sql: '1=1',
    description: 'Allow system to read join paths for query construction',
  },
  {
    targetTable: 'rls_join_conditions',
    sql: '1=1',
    description: 'Allow system to read join conditions',
  },
  {
    targetTable: 'rls_scope_templates',
    sql: '1=1',
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
  });

  await dataSource.initialize();
  console.log('Database connection established.\n');

  const mockCls = {
    runWith: async (context: any, callback: () => Promise<any>) => {
      // Note: This mock CLS does not set __rlsBypass context.
      // The bypassService.runSystemBypass() directly calls the callback
      // without using this mock, so this is purely for type compatibility.
      return callback();
    },
  } as unknown as ClsService;

  const bypassService = new RlsSystemBypassService(mockCls);

  await bypassService.runSystemBypass(async () => {
    for (const rule of FUNDAMENTAL_RULES) {
      const existing = await dataSource.query(
        `SELECT id FROM rls_rules WHERE group_id = 1 AND target_table = ? AND sql = ?`,
        [rule.targetTable, rule.sql],
      );

      if (existing.length === 0) {
        await dataSource.query(
          `INSERT INTO rls_rules (group_id, target_table, sql, parameters, created_at, updated_at)
           VALUES (1, ?, ?, NULL, datetime('now'), datetime('now'))`,
          [rule.targetTable, rule.sql],
        );
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
