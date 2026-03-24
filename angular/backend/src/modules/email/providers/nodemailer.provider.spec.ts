import { Test, TestingModule } from '@nestjs/testing';
import { NodemailerEmailProvider } from './nodemailer.provider';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('nodemailer');
jest.mock('fs');
jest.mock('path');

describe('NodemailerEmailProvider', () => {
  let provider: NodemailerEmailProvider;
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

  const mockConfigService = {
    get: jest.fn().mockImplementation((key) => {
      if (key === 'email.transport') return { host: 'localhost' };
      if (key === 'email.defaults') return {};
      return undefined;
    }),
  };

  const mockTransporter = {
    sendMail: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (nodemailer.createTransport as jest.Mock).mockReturnValue(mockTransporter);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NodemailerEmailProvider,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    provider = module.get<NodemailerEmailProvider>(NodemailerEmailProvider);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('sendEmail', () => {
    it('should send email successfully with HTML content', async () => {
      const options = {
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>Test HTML content</p>',
      };

      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });

      const result = await provider.sendEmail(options);

      expect(result).toEqual({ success: true, messageId: 'test-message-id' });
      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        to: options.to,
        subject: options.subject,
        text: undefined,
        html: options.html,
      });
    });

    it('should send email successfully with template and context', async () => {
      const options = {
        to: 'test@example.com',
        subject: 'Test Subject',
        template: 'verify-email',
        context: {
          userName: 'Test User',
          verificationUrl: 'http://localhost:4200/verify',
          token: 'test-token',
        },
      };

      const mockTemplateContent = `
        <html>
          <body>
            <h1>Hello {{ userName }},</h1>
            <p>Please verify your email: <a href="{{ verificationUrl }}">Verify</a></p>
            <p>Token: {{ token }}</p>
          </body>
        </html>
      `;

      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });
      (fs.readFileSync as jest.Mock).mockReturnValue(mockTemplateContent);

      const result = await provider.sendEmail(options);

      expect(result).toEqual({ success: true, messageId: 'test-message-id' });
      
      const expectedHtml = mockTemplateContent
        .replace(/\{\{\s*userName\s*\}\}/g, 'Test User')
        .replace(/\{\{\s*verificationUrl\s*\}\}/g, 'http://localhost:4200/verify')
        .replace(/\{\{\s*token\s*\}\}/g, 'test-token');

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: options.to,
          subject: options.subject,
          html: expectedHtml,
        })
      );
    });

    it('should handle template rendering errors gracefully', async () => {
      const options = {
        to: 'test@example.com',
        subject: 'Test Subject',
        template: 'non-existent-template',
        context: {},
      };

      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Template not found');
      });

      const result = await provider.sendEmail(options);

      expect(result).toEqual({ success: true, messageId: 'test-message-id' });
    });

    it('should handle transporter send failures', async () => {
      const options = {
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>Test content</p>',
      };

      mockTransporter.sendMail.mockRejectedValue(new Error('SMTP connection failed'));

      const result = await provider.sendEmail(options);

      expect(result).toEqual({ success: false, error: 'SMTP connection failed' });
    });

    it('should handle missing transporter gracefully', async () => {
      const options = {
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>Test content</p>',
      };

      // Set transporter to null to test this condition
      (provider as any).transporter = null;

      const result = await provider.sendEmail(options);

      expect(result).toEqual({ success: false, error: 'Email not configured' });
    });

    it('should sanitize HTML content for security', async () => {
      const options = {
        to: 'test@example.com',
        subject: 'Test Subject',
        template: 'test-template',
        context: {
          maliciousContent: '<script>alert("xss")</script>',
          normalContent: 'Normal text',
        },
      };

      const mockTemplateContent = `
        <html>
          <body>
            <div>{{ maliciousContent }}</div>
            <div>{{ normalContent }}</div>
          </body>
        </html>
      `;

      const expectedSanitizedContent = `
        <html>
          <body>
            <div>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</div>
            <div>Normal text</div>
          </body>
        </html>
      `;

      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });
      (fs.readFileSync as jest.Mock).mockReturnValue(mockTemplateContent);

      const result = await provider.sendEmail(options);

      expect(result).toEqual({ success: true, messageId: 'test-message-id' });
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expectedSanitizedContent,
        })
      );
    });
  });

  describe('renderTemplate', () => {
    it('should render template with context variables', async () => {
      const templateName = 'test-template';
      const context = {
        name: 'Test User',
        url: 'http://example.com',
        count: 42,
      };

      const templateContent = `
        <html>
          <body>
            <h1>Hello {{ name }},</h1>
            <p>Visit {{ url }}</p>
            <p>You have {{ count }} messages</p>
          </body>
        </html>
      `;

      (fs.readFileSync as jest.Mock).mockReturnValue(templateContent);

      const result = await provider['renderTemplate'](templateName, context);

      expect(result).toContain('Hello Test User,');
      expect(result).toContain('Visit http://example.com');
      expect(result).toContain('You have 42 messages');
    });

    it('should handle missing context variables', async () => {
      const templateName = 'test-template';
      const context = {
        name: 'Test User',
      };

      const templateContent = `
        <html>
          <body>
            <h1>Hello {{ name }},</h1>
            <p>Missing: {{ missingVar }}</p>
          </body>
        </html>
      `;

      (fs.readFileSync as jest.Mock).mockReturnValue(templateContent);

      const result = await provider['renderTemplate'](templateName, context);

      expect(result).toContain('Hello Test User,');
      expect(result).toContain('Missing: {{ missingVar }}');
    });

    it('should handle template loading errors', async () => {
      const templateName = 'non-existent-template';
      const context = {};

      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('File not found');
      });

      const result = await provider['renderTemplate'](templateName, context);

      expect(result).toContain('Email template error: non-existent-template');
    });
  });

  describe('sanitize', () => {
    it('should sanitize malicious HTML content', () => {
      const maliciousContent = `
        <script>alert("xss")</script>
        <img src="x" onerror="alert('xss')">
        <div onmouseover="alert('xss')">Hover me</div>
      `;

      const result = provider['sanitize'](maliciousContent);

      expect(result).toContain('&lt;script&gt;');
      expect(result).toContain('&lt;img');
      expect(result).toContain('alert(&quot;xss&quot;)');
    });

    it('should preserve safe HTML content', () => {
      const safeContent = `
        <div class="safe">Safe content</div>
        <p>Normal paragraph</p>
        <a href="http://example.com">Link</a>
      `;

      const result = provider['sanitize'](safeContent);

      expect(result).toContain('&lt;div class=&quot;safe&quot;&gt;');
      expect(result).toContain('&lt;p&gt;');
      expect(result).toContain('&lt;a href=&quot;http://example.com&quot;&gt;');
    });
  });

  describe('getProviderName', () => {
    it('should return provider name', () => {
      const result = provider.getProviderName();
      expect(result).toBe('nodemailer');
    });
  });

  describe('transport initialization', () => {
    it('should initialize transporter with configuration', () => {
      const mockTransportConfig = {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: 'test@gmail.com',
          pass: 'test-password',
        },
      };

      const mockDefaults = {
        from: '"Angular App" <no-reply@example.com>',
      };

      mockConfigService.get.mockImplementation((key) => {
        if (key === 'email.transport') return mockTransportConfig;
        if (key === 'email.defaults') return mockDefaults;
        return undefined;
      });

      // Trigger initialization by accessing transporter
      expect(() => {
        (provider as any)['initializeTransporter']();
      }).not.toThrow();

      expect(nodemailer.createTransport).toHaveBeenCalledWith(mockTransportConfig, mockDefaults);
    });
  });
});
