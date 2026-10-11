import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PasswordValidationService } from './password-validation.service';
import { User } from '../users/entities/user.entity';
import { Role } from '../users/entities/role.entity';
import { EmailService } from '../email/email.service';
import { LoginAttemptService } from './services/login-attempt.service';
import { IPReputationService } from './services/ip-reputation.service';
import { CaptchaService } from './services/captcha.service';
import { PatternDetectionService } from './services/pattern-detection.service';
import { AlertService } from './services/alert.service';
import { PermissionsService } from '../permissions/services/permissions.service';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid'),
}));

describe('AuthService', () => {
  let service: AuthService;
  let usersService: UsersService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let passwordValidationService: PasswordValidationService;
  let roleRepository: Repository<Role>;

  const mockUsersService = {
    findByEmail: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateLastLogin: jest.fn(),
    findByUsername: jest.fn(),
    updateVerificationSentAt: jest.fn(),
    verifyEmail: jest.fn(),
    userExistsCheck: jest.fn().mockResolvedValue(true),
  };

  const mockJwtService = {
    sign: jest.fn(() => 'signed-jwt-token'),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key, defaultValue) => {
      if (key === 'JWT_REFRESH_EXPIRES_IN') return '30d';
      if (key === 'JWT_EXPIRES_IN') return '7d';
      return defaultValue;
    }),
  };

  const mockPasswordValidationService = {
    validate: jest.fn().mockReturnValue(true),
  };

  const mockRoleRepository = {
    findOne: jest.fn(),
  };

  const mockEmailService = {
    sendVerificationEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
    sendWelcomeEmail: jest.fn(),
  };

  const mockLoginAttemptService = {
    create: jest.fn(),
    getRecentFailedAttempts: jest.fn().mockResolvedValue([]),
    getRecentAttempts: jest.fn().mockResolvedValue([]),
  };

  const mockIpReputationService = {
    isBlocked: jest.fn().mockResolvedValue(false),
  };

  const mockCaptchaService = {
    create: jest.fn(),
    validate: jest.fn(),
  };

  const mockPatternDetectionService = {
    trackSuccessfulLoginBehavior: jest.fn(),
    detectPatterns: jest.fn().mockResolvedValue([]),
  };

  const mockAlertService = {
    sendAlert: jest.fn(),
    sendPatternAlert: jest.fn(),
  };

  const mockPermissionsService = {
    getUserPermissions: jest.fn().mockResolvedValue([]),
    getUserPermissionsSafe: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: PasswordValidationService,
          useValue: mockPasswordValidationService,
        },
        {
          provide: getRepositoryToken(Role),
          useValue: mockRoleRepository,
        },
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
        {
          provide: LoginAttemptService,
          useValue: mockLoginAttemptService,
        },
        {
          provide: IPReputationService,
          useValue: mockIpReputationService,
        },
        {
          provide: CaptchaService,
          useValue: mockCaptchaService,
        },
        {
          provide: PatternDetectionService,
          useValue: mockPatternDetectionService,
        },
        {
          provide: AlertService,
          useValue: mockAlertService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    // Explicitly clear the private refreshTokens map for each test
    (service as any).refreshTokens.clear();
    
    usersService = module.get<UsersService>(UsersService);
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);
    passwordValidationService = module.get<PasswordValidationService>(
      PasswordValidationService,
    );
    roleRepository = module.get<Repository<Role>>(getRepositoryToken(Role));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser', () => {
    it('should return user without password when credentials are valid', async () => {
      const user = {
        id: 1,
        email: 'test@example.com',
        password: 'hashed-password',
        firstName: 'Test',
        lastName: 'User',
        isActive: true,
      };

      mockUsersService.userExistsCheck.mockResolvedValue(true);
      mockUsersService.findByEmail.mockResolvedValue(user);
      jest
        .spyOn(bcrypt, 'compare')
        .mockImplementation(() => Promise.resolve(true));

      const result = await service.validateUser(
        'test@example.com',
        'password123',
      );

      expect(result).toBeDefined();
      expect(result!.id).toEqual(user.id);
    });

    it('should return null when user is not found', async () => {
      // If userExistsCheck returns false, validateUser should return null immediately
      mockUsersService.userExistsCheck.mockResolvedValue(false);

      const result = await service.validateUser(
        'nonexistent@example.com',
        'password123',
      );

      expect(result).toBeNull();
    });

    it('should return null when password is incorrect', async () => {
      const user = {
        id: 1,
        email: 'test@example.com',
        password: 'hashed-password',
        isActive: true,
      };

      mockUsersService.userExistsCheck.mockResolvedValue(true);
      mockUsersService.findByEmail.mockResolvedValue(user);
      jest
        .spyOn(bcrypt, 'compare')
        .mockImplementation(() => Promise.resolve(false));

      const result = await service.validateUser(
        'test@example.com',
        'wrongpassword',
      );

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should update last login and return access and refresh tokens', async () => {
      const user = {
        id: 1,
        email: 'test@example.com',
      };
      const ipAddress = '127.0.0.1';

      mockUsersService.findByEmail.mockResolvedValue(user);
      mockUsersService.updateLastLogin.mockResolvedValue(undefined);
      mockJwtService.sign.mockReturnValue('token');
      (service as any).validateUser = jest.fn().mockResolvedValue(user);

      const result = await service.login(user.email, 'password', ipAddress);

      expect(mockUsersService.updateLastLogin).toHaveBeenCalledWith(user.id);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('csrfToken');
      expect(result).toHaveProperty('expiresIn');
    });
  });

  describe('register', () => {
    const registerDto = {
      email: 'new@example.com',
      password: 'StrongPass123!',
      firstName: 'New',
      lastName: 'User',
      username: 'newuser'
    };

    it('should register a new user and return user details', async () => {
      const defaultRole = { id: 1, name: 'user' };
      const newUser = {
        id: 1,
        ...registerDto,
        password: 'hashed-password',
        role: defaultRole,
      };

      mockUsersService.findByEmail.mockResolvedValue(null);
      mockRoleRepository.findOne.mockResolvedValue(defaultRole);
      mockUsersService.create.mockResolvedValue(newUser);

      const result = await service.register(registerDto);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('email');
      expect(result).not.toHaveProperty('password');
      expect(mockPasswordValidationService.validate).toHaveBeenCalledWith(
        registerDto.password,
      );
    });

    it('should throw BadRequestException if email already exists', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        id: 1,
        email: registerDto.email,
      });

      await expect(service.register(registerDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUsersService.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if default role not found', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      mockRoleRepository.findOne.mockResolvedValue(null);

      await expect(service.register(registerDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUsersService.create).not.toHaveBeenCalled();
    });
  });

  describe('refreshToken', () => {
    it('should generate new tokens with a valid refresh token', async () => {
      const user = { id: 1, email: 'test@example.com' };
      const refreshToken = 'valid-refresh-token';

      mockJwtService.verify.mockReturnValue({ sub: user.id, email: user.email, type: 'access' });
      mockUsersService.findOne.mockResolvedValue(user);
      mockPermissionsService.getUserPermissions.mockResolvedValue([]);

      const result = await service.refreshToken(refreshToken);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('should throw UnauthorizedException if refresh token is invalid', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });
      
      await expect(service.refreshToken('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    beforeEach(() => {
      (service as any).refreshTokens.clear();
    });

    it('should remove the refresh token and return success', async () => {
      const refreshToken = 'valid-refresh-token';

      (service as any).refreshTokens.set('test-uuid', {
        userId: 1,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const result = await service.logout(refreshToken);

      expect(result).toEqual({ success: true });
      expect((service as any).refreshTokens.size).toBe(0);
    });

    it('should return success even if token not found', async () => {
      const result = await service.logout('nonexistent-token');

      expect(result).toEqual({ success: true });
    });
  });

  describe('forgotPassword', () => {
    it('should return success message and reset token when email exists', async () => {
      const user = { id: 1, email: 'test@example.com' };
      mockUsersService.findByEmail.mockResolvedValue(user);

      const result = await service.forgotPassword({
        email: 'test@example.com',
      });

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('message');
      // The resetToken is no longer returned in the successful response for security/privacy reasons
      expect(mockJwtService.sign).toHaveBeenCalled();
    });

    it('should return generic success message when email does not exist', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);

      const result = await service.forgotPassword({
        email: 'nonexistent@example.com',
      });

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('message');
      expect(mockJwtService.sign).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const resetDto = {
      password: 'NewPassword123!',
      passwordConfirmation: 'NewPassword123!',
      token: 'valid-reset-token',
    };

    it('should reset password with valid token and matching passwords', async () => {
      const user = { id: 1, email: 'test@example.com' };

      mockJwtService.verify.mockReturnValue({ sub: user.id, type: 'password_reset' });
      mockUsersService.findOne.mockResolvedValue(user);
      mockUsersService.update.mockResolvedValue({});

      const result = await service.resetPassword(resetDto);

      expect(result).toEqual({
        success: true,
        message: 'Password reset successfully',
      });
      expect(mockPasswordValidationService.validate).toHaveBeenCalledWith(
        resetDto.password,
      );
      expect(mockUsersService.update).toHaveBeenCalledWith(user.id, {
        password: resetDto.password,
      });
    });

    it('should throw BadRequestException if passwords do not match', async () => {
      const mismatchedDto = {
        ...resetDto,
        passwordConfirmation: 'DifferentPassword123!',
      };

      await expect(service.resetPassword(mismatchedDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockJwtService.verify).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if token is invalid', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(service.resetPassword(resetDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if token is not a reset token', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 1, type: 'access' });

      await expect(service.resetPassword(resetDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
