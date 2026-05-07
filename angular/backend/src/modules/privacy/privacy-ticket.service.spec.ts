import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PrivacyTicketService } from './privacy-ticket.service';
import { PrivacyTicket, PrivacyRequestType, PrivacyRegulation, PrivacyTicketStatus } from './entities/privacy-ticket.entity';
import { PrivacyJob } from './entities/privacy-job.entity';
import { PrivacyJurisdictionService } from './privacy-jurisdiction.service';
import { PrivacyMagicLinkService } from './privacy-magic-link.service';
import { UsersService } from '../users/users.service';

describe('PrivacyTicketService', () => {
  let service: PrivacyTicketService;
  let jurisdictionService: any;
  let magicLinkService: any;
  let usersService: any;
  let ticketRepository: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrivacyTicketService,
        {
          provide: getRepositoryToken(PrivacyTicket),
          useValue: {
            create: jest.fn().mockReturnValue({ id: 1 }),
            save: jest.fn().mockResolvedValue({ id: 1 }),
            findOne: jest.fn().mockResolvedValue({ id: 1 }),
          },
        },
        {
          provide: getRepositoryToken(PrivacyJob),
          useValue: {
            create: jest.fn().mockReturnValue({}),
            save: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: PrivacyJurisdictionService,
          useValue: {
            resolveRegulation: jest.fn().mockReturnValue(PrivacyRegulation.OTHER),
            getSlaDeadline: jest.fn().mockReturnValue(new Date()),
          },
        },
        {
          provide: PrivacyMagicLinkService,
          useValue: {
            generateToken: jest.fn().mockReturnValue('mock-token'),
            generateUrl: jest.fn().mockReturnValue('http://mock-url'),
            verifyToken: jest.fn().mockReturnValue({ ticketId: 1, email: 'test@example.com' }),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findOne: jest.fn().mockResolvedValue({ id: 1, preferences: { region: 'US-CA' } }),
          },
        },
      ],
    }).compile();

    service = module.get<PrivacyTicketService>(PrivacyTicketService);
    jurisdictionService = module.get<PrivacyJurisdictionService>(PrivacyJurisdictionService);
    magicLinkService = module.get<PrivacyMagicLinkService>(PrivacyMagicLinkService);
    usersService = module.get<UsersService>(UsersService);
    ticketRepository = module.get(getRepositoryToken(PrivacyTicket));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createTicket fallback logic', () => {
    it('should use jurisdiction service if regulation is not provided', async () => {
      await service.createTicket(1, {
        requestType: PrivacyRequestType.EXPORT,
      });

      expect(jurisdictionService.resolveRegulation).toHaveBeenCalled();
    });

    it('should pass profileRegion to resolveRegulation', async () => {
      await service.createTicket(1, {
        requestType: PrivacyRequestType.EXPORT,
      });

      expect(jurisdictionService.resolveRegulation).toHaveBeenCalledWith(undefined, undefined, 'US-CA');
    });
  });

  describe('createPublicTicket', () => {
    it('should generate a magic link for public tickets', async () => {
      const result = await service.createPublicTicket({
        requestType: PrivacyRequestType.ERASURE,
        email: 'test@example.com',
      });

      expect(magicLinkService.generateToken).toHaveBeenCalledWith(1, 'test@example.com');
      expect(magicLinkService.generateUrl).toHaveBeenCalledWith('mock-token');
      expect(result.magicLink).toBe('http://mock-url');
    });
  });
});
