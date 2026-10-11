import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PrivacyJob, PrivacyJobStatus } from './entities/privacy-job.entity';
import { PrivacyTicket, PrivacyTicketStatus, PrivacyRequestType, PrivacyRegulation } from './entities/privacy-ticket.entity';
import { User } from '../users/entities/user.entity';
import { Role } from '../users/entities/role.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { Group } from '../users/entities/group.entity';
import { GroupPermission } from '../permissions/entities/group-permission.entity';
import { Action } from '../permissions/entities/action.entity';
import { RolePermission } from '../permissions/entities/role-permission.entity';
import { UserPermission } from '../permissions/entities/user-permission.entity';
import { Resource } from '../permissions/entities/resource.entity';
import { UiComponent } from '../permissions/entities/ui-component.entity';
import { FrontendRoute } from '../permissions/entities/frontend-route.entity';
import { ApiEndpoint } from '../permissions/entities/api-endpoint.entity';
import { Route } from '../permissions/entities/route.entity';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

describe('Privacy Persistence Integration', () => {
  let ticketRepository: Repository<PrivacyTicket>;
  let jobRepository: Repository<PrivacyJob>;
  let userRepository: Repository<User>;
  let dataSource: DataSource;

  const entities = [
    PrivacyTicket, 
    PrivacyJob, 
    User, 
    Role, 
    Permission, 
    Group, 
    GroupPermission, 
    Action, 
    RolePermission, 
    UserPermission, 
    Resource,
    UiComponent,
    FrontendRoute,
    ApiEndpoint,
    Route
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: entities,
          synchronize: true,
          namingStrategy: new SnakeNamingStrategy(),
        }),
        TypeOrmModule.forFeature(entities),
      ],
    }).compile();

    ticketRepository = moduleRef.get<Repository<PrivacyTicket>>(getRepositoryToken(PrivacyTicket));
    jobRepository = moduleRef.get<Repository<PrivacyJob>>(getRepositoryToken(PrivacyJob));
    userRepository = moduleRef.get<Repository<User>>(getRepositoryToken(User));
    dataSource = moduleRef.get<DataSource>(DataSource);
  }, 30000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  it('should persist a privacy ticket and its jobs', async () => {
    // 1. Create a user
    const user = userRepository.create({
      email: 'privacy-test@example.com',
      username: 'privacytest',
      password: 'hashed-password',
      firstName: 'Privacy',
      lastName: 'Test',
    });
    await userRepository.save(user);

    // 2. Create a privacy ticket
    const ticket = ticketRepository.create({
      requestType: PrivacyRequestType.EXPORT,
      status: PrivacyTicketStatus.PENDING,
      user: user,
      regulation: PrivacyRegulation.GDPR,
      slaDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      description: 'Test export request',
    });
    const savedTicket = await ticketRepository.save(ticket);

    expect(savedTicket.id).toBeDefined();
    expect(savedTicket.userId).toBe(user.id);

    // 3. Create a privacy job for the ticket
    const job = jobRepository.create({
      ticket: savedTicket,
      status: PrivacyJobStatus.PENDING,
      providerResults: { some: 'initial data' },
    });
    const savedJob = await jobRepository.save(job);

    expect(savedJob.id).toBeDefined();
    expect(savedJob.ticketId).toBe(savedTicket.id);

    // 4. Retrieve and verify
    const retrievedTicket = await ticketRepository.findOne({
      where: { id: savedTicket.id },
      relations: ['jobs', 'user'],
    });

    expect(retrievedTicket).toBeDefined();
    expect(retrievedTicket?.jobs).toHaveLength(1);
    expect(retrievedTicket?.jobs[0].id).toBe(savedJob.id);
    expect(retrievedTicket?.user.id).toBe(user.id);
  });

  it('should handle JSON results in privacy jobs', async () => {
    const ticket = await ticketRepository.save(
      ticketRepository.create({
        requestType: PrivacyRequestType.ERASURE,
        status: PrivacyTicketStatus.PENDING,
        regulation: PrivacyRegulation.CCPA,
        slaDeadline: new Date(),
        description: 'Test erasure request',
      })
    );

    const complexResults = {
      provider1: { deleted: true, count: 10 },
      provider2: { error: 'Service unavailable', retry: true },
    };

    const job = await jobRepository.save(
      jobRepository.create({
        ticket,
        status: PrivacyJobStatus.PROCESSING,
        providerResults: complexResults,
      })
    );

    const retrievedJob = await jobRepository.findOne({ where: { id: job.id } });
    expect(retrievedJob?.providerResults).toEqual(complexResults);
  });
});
