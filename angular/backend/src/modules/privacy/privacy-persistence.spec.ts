import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PrivacyJob, PrivacyJobStatus } from './entities/privacy-job.entity';
import { PrivacyTicket, PrivacyTicketStatus, PrivacyRequestType, PrivacyRegulation } from './entities/privacy-ticket.entity';
import { User } from '../users/entities/user.entity';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

describe('Privacy Persistence Integration', () => {
  let ticketRepository: Repository<PrivacyTicket>;
  let jobRepository: Repository<PrivacyJob>;
  let userRepository: Repository<User>;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [PrivacyTicket, PrivacyJob, User],
          synchronize: true,
          namingStrategy: new SnakeNamingStrategy(),
        }),
        TypeOrmModule.forFeature([PrivacyTicket, PrivacyJob, User]),
      ],
    }).compile();

    ticketRepository = module.get<Repository<PrivacyTicket>>(getRepositoryToken(PrivacyTicket));
    jobRepository = module.get<Repository<PrivacyJob>>(getRepositoryToken(PrivacyJob));
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    dataSource = module.get<DataSource>(DataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('should persist a privacy ticket and its jobs', async () => {
    // 1. Create a user
    const user = userRepository.create({
      email: 'privacy-test@example.com',
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
