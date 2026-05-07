import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PrivacyHousekeepingService } from './privacy-housekeeping.service';
import { PrivacyJob, PrivacyJobStatus } from './entities/privacy-job.entity';
import { PrivacyTicket, PrivacyRequestType } from './entities/privacy-ticket.entity';
import { PrivacyRegistryService } from './privacy-registry.service';
import { SecurityAlertService } from '../auth/services/security-alert.service';

describe('PrivacyHousekeepingService', () => {
  let service: PrivacyHousekeepingService;
  let jobRepository: any;
  let securityAlertService: any;
  let registryService: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrivacyHousekeepingService,
        {
          provide: getRepositoryToken(PrivacyJob),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            findOne: jest.fn().mockResolvedValue({ id: 1 }),
            save: jest.fn().mockResolvedValue({}),
            count: jest.fn().mockResolvedValue(1),
          },
        },
        {
          provide: getRepositoryToken(PrivacyTicket),
          useValue: {
            update: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: PrivacyRegistryService,
          useValue: {
            getProviders: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: SecurityAlertService,
          useValue: {
            createAlert: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<PrivacyHousekeepingService>(PrivacyHousekeepingService);
    jobRepository = module.get(getRepositoryToken(PrivacyJob));
    securityAlertService = module.get<SecurityAlertService>(SecurityAlertService);
    registryService = module.get<PrivacyRegistryService>(PrivacyRegistryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processJobs batch processing limit', () => {
    it('should process jobs in batches of 50', async () => {
      // Mock find to return one batch of 1 job, then empty
      jobRepository.find.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);
      
      await service.processJobs();

      expect(jobRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 })
      );
    });
  });

  describe('handleJob PARTIAL_SUCCESS erasure failure policy', () => {
    it('should mark job as PARTIAL_SUCCESS and create alert if some providers fail on erasure', async () => {
      const mockJob = {
        id: 1,
        ticketId: 1,
        ticket: {
          id: 1,
          requestType: PrivacyRequestType.ERASURE,
          userId: 1,
        },
      };

      registryService.getProviders.mockReturnValue([
        {
          providerName: 'SuccessProvider',
          onDelete: jest.fn().mockResolvedValue(undefined),
        },
        {
          providerName: 'FailProvider',
          onDelete: jest.fn().mockRejectedValue(new Error('Failed to delete')),
        },
      ]);

      // Call private method
      await (service as any).handleJob(mockJob);

      expect(jobRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PrivacyJobStatus.PARTIAL_SUCCESS,
        })
      );

      expect(securityAlertService.createAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: 'PRIVACY_FAILURE',
          severity: 'HIGH',
        })
      );
    });
  });
});
