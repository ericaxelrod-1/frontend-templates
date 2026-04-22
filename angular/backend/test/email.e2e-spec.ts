import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/modules/email/email.service';
import { ConfigService } from '@nestjs/config';

/**
 * Email E2E Tests
 * 
 * These tests verify that the EmailService actually sends emails that are
 * captured by the MailDev server running on port 1080 (Web API).
 * 
 * PRE-REQUISITES:
 * 1. MailDev must be running on port 1025 (SMTP) and 1080 (HTTP).
 * 2. EMAIL_ENABLED must be true in the environment.
 */
describe('Email E2E (Real SMTP)', () => {
  let app: NestFastifyApplication;
  let emailService: EmailService;
  let configService: ConfigService;
  const MAILDEV_API = 'http://localhost:1080/email';

  beforeAll(async () => {
    // We use the real AppModule to ensure all providers and configs are loaded
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    emailService = app.get<EmailService>(EmailService, { strict: false });
    configService = app.get<ConfigService>(ConfigService, { strict: false });

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // Check if MailDev is accessible
    try {
      await fetch(MAILDEV_API);
    } catch (error) {
      console.warn('MailDev is not running on http://localhost:1080. E2E tests will likely fail.');
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clear all emails in MailDev before each test
    try {
      await fetch(MAILDEV_API + '/all', { method: 'DELETE' });
    } catch (e) {
      // Ignore errors if MailDev is not running
    }
  });

  it('should send a verification email and find it in MailDev', async () => {
    const testEmail = 'e2e-verify@example.com';
    const testName = 'E2E Verify User';
    const testToken = 'e2e-token-123';

    const result = await emailService.sendVerificationEmail(testEmail, testToken, testName);
    expect(result).toBe(true);

    // Wait a bit for SMTP delivery
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Fetch emails from MailDev
    const response = await fetch(MAILDEV_API);
    const emails = await response.json() as any[];

    const found = emails.find(e => e.to[0].address === testEmail);
    expect(found).toBeDefined();
    expect(found.subject).toBe('Verify Your Email Address');
    expect(found.html).toContain(testName);
    expect(found.html).toContain(testToken);
  });

  it('should send a password reset email and find it in MailDev', async () => {
    const testEmail = 'e2e-reset@example.com';
    const testName = 'E2E Reset User';
    const testToken = 'reset-token-abc';

    const result = await emailService.sendPasswordResetEmail(testEmail, testToken, testName);
    expect(result).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 1000));

    const response = await fetch(MAILDEV_API);
    const emails = await response.json() as any[];

    const found = emails.find(e => e.to[0].address === testEmail);
    expect(found).toBeDefined();
    expect(found.subject).toBe('Password Reset Request');
    expect(found.html).toContain(testName);
    expect(found.html).toContain(testToken);
  });

  it('should send a privacy ticket submitted email', async () => {
    const testEmail = 'e2e-privacy@example.com';
    const testName = 'E2E Privacy User';
    const ticketId = 'TICKET-123';

    const result = await emailService.sendTicketSubmittedEmail(
      testEmail,
      testName,
      ticketId,
      'Data Access Request',
      'high',
      new Date().toISOString()
    );
    expect(result).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 1000));

    const response = await fetch(MAILDEV_API);
    const emails = await response.json() as any[];

    const found = emails.find(e => e.to[0].address === testEmail);
    expect(found).toBeDefined();
    expect(found.subject).toContain('Privacy Ticket Submitted');
    expect(found.html).toContain(testName);
    expect(found.html).toContain(ticketId);
  });
});
