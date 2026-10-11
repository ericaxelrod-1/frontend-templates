import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { PrivacyAuditService } from './privacy-audit.service';
import { PrivacyAuditLog } from './entities/privacy-audit-log.entity';
import * as crypto from 'crypto';

describe('PrivacyAuditService', () => {
  let service: PrivacyAuditService;
  let configService: ConfigService;
  let auditRepository: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrivacyAuditService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'PRIVACY_KID') return 'v2';
              if (key === 'PRIVACY_PEPPER_v2') return 'pepper-v2';
              return defaultValue;
            }),
          },
        },
        {
          provide: getRepositoryToken(PrivacyAuditLog),
          useValue: {
            create: jest.fn((dto) => dto),
            save: jest.fn().mockResolvedValue({ id: 1 }),
          },
        },
      ],
    }).compile();

    service = module.get<PrivacyAuditService>(PrivacyAuditService);
    configService = module.get<ConfigService>(ConfigService);
    auditRepository = module.get(getRepositoryToken(PrivacyAuditLog));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('logAction', () => {
    it('should use the current KID and corresponding pepper', async () => {
      await service.logAction(101, 202, 'test-action');

      const expectedPepper = 'pepper-v2';
      const safeAction = 'test-action'.replace(/:/g, '\\:');
      const expectedData = `101:202:${safeAction}`;
      const expectedHash = crypto.createHmac('sha256', expectedPepper).update(expectedData).digest('hex');

      expect(auditRepository.create).toHaveBeenCalledWith(expect.objectContaining({
        ticketId: 101,
        userId: 202,
        action: 'test-action',
        hmacHash: expectedHash,
        kid: 'v2',
      }));
      expect(auditRepository.save).toHaveBeenCalled();
    });
  });
});
