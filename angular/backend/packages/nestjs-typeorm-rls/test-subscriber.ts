import { DataSource, Entity, PrimaryGeneratedColumn, Column, EntitySubscriberInterface, InsertEvent } from 'typeorm';

@Entity('users')
class User {
  @PrimaryGeneratedColumn()
  id!: number;
  @Column()
  name!: string;
}

class MySubscriber implements EntitySubscriberInterface {
  beforeInsert(event: InsertEvent<any>) {
    console.log('SUBSCRIBER FIRED!');
  }
}

async function test() {
  const dataSource = new DataSource({
    type: 'sqlite',
    database: ':memory:',
    entities: [User],
    synchronize: true,
  });
  await dataSource.initialize();

  // Try to register after initialization
  const sub = new MySubscriber();
  dataSource.subscribers.push(sub);

  await dataSource.manager.insert(User, { id: 1, name: 'Alice' });
  await dataSource.destroy();
}

test().catch(console.error);
