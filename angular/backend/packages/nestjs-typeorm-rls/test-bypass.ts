import { DataSource, Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { createEntityManagerProxy } from './src/proxy/entity-manager.proxy';

@Entity('users')
class User {
  @PrimaryGeneratedColumn()
  id!: number;
  @Column()
  tenant_id!: number;
  @Column()
  name!: string;
}

async function test() {
  const dataSource = new DataSource({
    type: 'sqlite',
    database: ':memory:',
    entities: [User],
    synchronize: true,
  });
  await dataSource.initialize();

  // Mock dependencies
  const mockCls = { get: (key: string) => null } as any;
  const mockRlsService = {} as any;
  const mockMetrics = { recordBlock: console.log } as any;
  const config = { exemptTables: [] };

  const manager = createEntityManagerProxy(dataSource.manager, mockCls, mockRlsService, mockMetrics, config);

  // Insert a test user without proxy
  await dataSource.manager.insert(User, { id: 1, tenant_id: 1, name: 'Alice' });

  console.log('Trying to save with target="users" and plain object');
  try {
    // If it bypasses, it won't throw RlsSecurityViolationError
    await manager.save('users', { id: 1, tenant_id: 2, name: 'Hacked' });
    console.log('SUCCESS (Bypassed!)');
  } catch (e: any) {
    console.log('CAUGHT:', e.message);
  }

  const result = await dataSource.manager.findOne(User, { where: { id: 1 } });
  console.log('Result:', result);
  await dataSource.destroy();
}

test().catch(console.error);
