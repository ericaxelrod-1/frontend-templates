import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { EmailProvider } from './email.provider.interface';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

describe('EmailService', () => {
  let service: EmailService;
  let emailProvider: EmailProvider;
  let configService: ConfigService;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'verbose').mockImplementation(() => {});
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  const mockEmailProvider = {
    sendEmail: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: 'EmailProvider',
          useValue: mockEmailProvider,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    emailProvider = module.get<EmailProvider>('EmailProvider');
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('sendVerificationEmail', () => {
    it('should send verification email successfully', async () => {
      const email = 'test@example.com';
      const token = 'jwt-token';
      const userName = 'Test User';
      const frontendUrl = 'http://localhost:4200';
      const expectedUrl = `${frontendUrl}/verify-email?token=${token}&email=${encodeURIComponent(email)}`;

      mockConfigService.get.mockReturnValue(frontendUrl);
      mockEmailProvider.sendEmail.mockResolvedValue({ success: true });

      const result = await service.sendVerificationEmail(email, token, userName);

      expect(result).toBe(true);
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith({
        to: email,
        subject: 'Verify Your Email Address',
        template: 'verify-email',
        context: {
          userName,
          verificationUrl: expectedUrl,
          token,
          expiresIn: '24 hours',
        },
      });
    });

    it('should return false when email provider fails', async () => {
      const email = 'test@example.com';
      const token = 'jwt-token';
      const userName = 'Test User';

      mockEmailProvider.sendEmail.mockResolvedValue({ 
        success: false, 
        error: 'Failed to send email' 
      });

      const result = await service.sendVerificationEmail(email, token, userName);

      expect(result).toBe(false);
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('should send password reset email successfully', async () => {
      const email = 'test@example.com';
      const token = 'jwt-token';
      const userName = 'Test User';
      const frontendUrl = 'http://localhost:4200';
      const expectedUrl = `${frontendUrl}/reset-password?token=${token}`;

      mockConfigService.get.mockReturnValue(frontendUrl);
      mockEmailProvider.sendEmail.mockResolvedValue({ success: true });

      const result = await service.sendPasswordResetEmail(email, token, userName);

      expect(result).toBe(true);
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith({
        to: email,
        subject: 'Password Reset Request',
        template: 'password-reset',
        context: {
          userName,
          resetUrl: expectedUrl,
          token,
          expiresIn: '1 hour',
        },
      });
    });
  });

  describe('sendWelcomeEmail', () => {
    it('should send welcome email successfully', async () => {
      const email = 'test@example.com';
      const userName = 'Test User';
      const frontendUrl = 'http://localhost:4200';
      const expectedUrl = `${frontendUrl}/login`;

      mockConfigService.get.mockReturnValue(frontendUrl);
      mockEmailProvider.sendEmail.mockResolvedValue({ success: true });

      const result = await service.sendWelcomeEmail(email, userName);

      expect(result).toBe(true);
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith({
        to: email,
        subject: 'Welcome to the Application',
        template: 'welcome-email',
        context: {
          userName,
          loginUrl: expectedUrl,
        },
      });
    });
  });

  describe('sendGenericEmail', () => {
    it('should send generic email successfully', async () => {
      const to = 'test@example.com';
      const subject = 'Test Subject';
      const template = 'custom-template';
      const context = { name: 'Test', message: 'Hello' };

      mockEmailProvider.sendEmail.mockResolvedValue({ success: true });

      const result = await service.sendGenericEmail(to, subject, template, context);

      expect(result).toBe(true);
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith({
        to,
        subject,
        template,
        context,
      });
    });
  });

  describe('error handling', () => {
    it('should handle email provider failures gracefully', async () => {
      const email = 'test@example.com';
      const token = 'jwt-token';
      const userName = 'Test User';

      mockEmailProvider.sendEmail.mockResolvedValue({ 
        success: false, 
        error: 'SMTP connection failed' 
      });

      const result = await service.sendVerificationEmail(email, token, userName);

      expect(result).toBe(false);
    });
  });
});
