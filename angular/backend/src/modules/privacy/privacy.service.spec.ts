import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PrivacyService } from './privacy.service';
import { User } from '../users/entities/user.entity';
import { LoginAttempt } from '../auth/entities/login-attempt.entity';
import { UserBehaviorProfile } from '../auth/entities/user-behavior-profile.entity';
import { SecurityAlert } from '../auth/entities/security-alert.entity';
import { UsersService } from '../users/users.service';
import { PrivacyRegistryService } from './privacy-registry.service';

describe('PrivacyService', () => {
  let service: PrivacyService;
  let loginAttemptRepository: any;
  let securityAlertRepository: any;
  let privacyRegistryService: any;
  let usersService: any;
  let userRepository: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrivacyService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            update: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: getRepositoryToken(LoginAttempt),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(UserBehaviorProfile),
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: getRepositoryToken(SecurityAlert),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findOne: jest.fn().mockResolvedValue({ id: 1, isDeleted: false }),
          },
        },
        {
          provide: PrivacyRegistryService,
          useValue: {
            getProviders: jest.fn().mockReturnValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<PrivacyService>(PrivacyService);
    loginAttemptRepository = module.get(getRepositoryToken(LoginAttempt));
    securityAlertRepository = module.get(getRepositoryToken(SecurityAlert));
    privacyRegistryService = module.get<PrivacyRegistryService>(PrivacyRegistryService);
    usersService = module.get<UsersService>(UsersService);
    userRepository = module.get(getRepositoryToken(User));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('exportUserData limits', () => {
    it('should limit loginHistory to 100 and securityAlerts to 50', async () => {
      await service.exportUserData(1);

      expect(loginAttemptRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      );

      expect(securityAlertRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 })
      );
    });
  });

  describe('deleteAccount logic', () => {
    it('should call onDelete for all providers and mark user as deleted', async () => {
      const mockProvider = {
        providerName: 'TestProvider',
        onDelete: jest.fn().mockResolvedValue(undefined),
      };
      privacyRegistryService.getProviders.mockReturnValue([mockProvider]);

      const result = await service.deleteAccount(1);

      expect(result.success).toBe(true);
      expect(mockProvider.onDelete).toHaveBeenCalledWith('1');
      expect(userRepository.update).toHaveBeenCalledWith(1, expect.objectContaining({ isDeleted: true }));
    });
  });
});
