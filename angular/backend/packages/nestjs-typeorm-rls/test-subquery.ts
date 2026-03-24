import { DataSource, Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { createQueryBuilderProxy } from './src/proxy/query-builder.proxy';

@Entity('users')
class User {
  @PrimaryGeneratedColumn()
  id!: number;
  @Column()
  tenant_id!: number;
  @Column()
  name!: string;
}

@Entity('orders')
class Order {
  @PrimaryGeneratedColumn()
  id!: number;
  @Column()
  userId!: number;
}

async function test() {
  const dataSource = new DataSource({
    type: 'sqlite',
    database: ':memory:',
    entities: [User, Order],
    synchronize: true,
  });
  await dataSource.initialize();

  const mockCls = { get: (key: string) => null } as any;
  const mockRlsService = {
    getRulesForTable: async (table: string) => {
      return { sql: 'tenant_id = :tid', parameters: { tid: 99 } };
    }
  } as any;
  const mockMetrics = { recordBlock: console.log, recordBypass: console.log } as any;
  const config = { exemptTables: [] };

  const qb = dataSource.manager.createQueryBuilder(Order, 'order');
  const proxy = createQueryBuilderProxy(qb, mockCls, mockRlsService, mockMetrics, config);

  proxy.where((sq: any) => {
    const subQuery = sq.subQuery().select('user.id').from(User, 'user').where('user.name = :name', { name: 'Alice' });
    return 'order.userId IN ' + subQuery.getQuery();
  });

  // Call getSql on the main proxy to see if the subquery got the RLS rule
  // wait, to get the subquery evaluated we need to run it or get its SQL.
  // Actually, we can just print the main query's SQL
  await proxy.getMany(); // triggering execution to apply rules to main query

  console.log('SQL:', proxy.getSql());
  await dataSource.destroy();
}

test().catch(console.error);
