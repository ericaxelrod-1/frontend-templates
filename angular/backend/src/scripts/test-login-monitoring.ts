import { NestFactory } from '@nestjs/core';
import { TestModule } from './test-module';
import { LoginAttemptService } from '../modules/auth/services/login-attempt.service';
import { IPReputationService } from '../modules/auth/services/ip-reputation.service';
import { CaptchaService } from '../modules/auth/services/captcha.service';
import { PatternDetectionService } from '../modules/auth/services/pattern-detection.service';
import {
  AlertService,
  AlertSeverity,
} from '../modules/auth/services/alert.service';
import { Logger } from '@nestjs/common';

/**
 * Test script for the Login Monitoring System
 *
 * This script tests various components of the Login Monitoring System:
 * - Login attempt tracking
 * - IP reputation management
 * - CAPTCHA generation and validation
 * - Pattern detection
 * - Alert system
 *
 * Usage: npm run test:login-monitoring
 */
async function testLoginMonitoring() {
  const logger = new Logger('TestLoginMonitoring');
  logger.log('Starting Login Monitoring System test...');

  try {
    // Create a standalone NestJS application context
    const app = await NestFactory.createApplicationContext(TestModule);

    // Get services
    const loginAttemptService = app.get(LoginAttemptService);
    const ipReputationService = app.get(IPReputationService);
    const captchaService = app.get(CaptchaService);
    const patternDetectionService = app.get(PatternDetectionService);
    const alertService = app.get(AlertService);

    logger.log('Successfully initialized all services');

    // Test 1: Record login attempts
    logger.log('Test 1: Recording login attempts...');

    // Record a successful login
    const successfulAttempt = await loginAttemptService.create({
      ipAddress: '192.168.1.100',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/98.0.4758.102',
      emailAttempted: 'test@example.com',
      status: 'success',
    });
    logger.log(
      `Successfully recorded login attempt: ID ${successfulAttempt.id}, Status: ${successfulAttempt.status}`,
    );

    // Record a failed login
    const failedAttempt = await loginAttemptService.create({
      ipAddress: '192.168.1.101',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/97.0',
      emailAttempted: 'test@example.com',
      status: 'failed',
      failureReason: 'Invalid password',
    });
    logger.log(
      `Successfully recorded login attempt: ID ${failedAttempt.id}, Status: ${failedAttempt.status}`,
    );

    // Test 2: IP Reputation
    logger.log('Test 2: Testing IP reputation management...');

    // Get reputation for a new IP
    const reputation = await ipReputationService.getOrCreate('192.168.1.102');
    logger.log(
      `Created IP reputation: ${reputation.ipAddress}, Failed attempts: ${reputation.failedLoginAttempts}, Blocked: ${reputation.isManuallyBlocked}`,
    );


    // Increment failed attempts
    await ipReputationService.incrementFailedAttempts('192.168.1.102');
    await ipReputationService.incrementFailedAttempts('192.168.1.102');
    await ipReputationService.incrementFailedAttempts('192.168.1.102');
    await ipReputationService.incrementFailedAttempts('192.168.1.102');

    // Check if blocked after multiple failed attempts
    const updatedReputation =
      await ipReputationService.getOrCreate('192.168.1.102');
    logger.log(
      `Updated IP reputation: ${updatedReputation.ipAddress}, Failed attempts: ${updatedReputation.failedLoginAttempts}, Blocked: ${updatedReputation.isManuallyBlocked}`,
    );


    // Check if captcha is required
    const captchaRequired =
      await ipReputationService.requiresCaptcha('192.168.1.102');
    logger.log(`CAPTCHA required: ${captchaRequired}`);

    // Test 3: CAPTCHA
    logger.log('Test 3: Testing CAPTCHA generation and validation...');

    // Generate a text CAPTCHA
    const textCaptcha = await captchaService.create('text', '192.168.1.103');
    logger.log(
      `Generated text CAPTCHA: Token: ${textCaptcha.token}, Solution: ${textCaptcha.solution}`,
    );

    // Validate CAPTCHA (correct solution)
    const validResult = await captchaService.validate(
      textCaptcha.token,
      textCaptcha.solution,
    );
    logger.log(`CAPTCHA validation (correct solution): ${validResult}`);

    // Generate another CAPTCHA
    const mathCaptcha = await captchaService.create('math', '192.168.1.103');
    logger.log(
      `Generated math CAPTCHA: Token: ${mathCaptcha.token}, Challenge: ${mathCaptcha.challenge}, Solution: ${mathCaptcha.solution}`,
    );

    // Validate CAPTCHA (incorrect solution)
    const invalidResult = await captchaService.validate(
      mathCaptcha.token,
      'wrong_solution',
    );
    logger.log(`CAPTCHA validation (incorrect solution): ${invalidResult}`);

    // Test 4: Pattern Detection
    logger.log('Test 4: Testing pattern detection...');

    // Simulate multiple failed logins from same IP
    for (let i = 0; i < 5; i++) {
      await loginAttemptService.create({
        ipAddress: '192.168.1.200',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/98.0.4758.102',
        emailAttempted: 'victim@example.com',
        status: 'failed',
        failureReason: 'Invalid password',
      });
    }

    // Simulate distributed attack (multiple IPs targeting same account)
    for (let i = 0; i < 5; i++) {
      await loginAttemptService.create({
        ipAddress: `192.168.1.${210 + i}`,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/98.0.4758.102',
        emailAttempted: 'victim@example.com',
        status: 'failed',
        failureReason: 'Invalid password',
      });
    }

    // Run pattern detection
    const patterns = await patternDetectionService.detectPatterns();
    if (patterns.length > 0) {
      logger.log(`Detected ${patterns.length} suspicious patterns:`);
      patterns.forEach((pattern, index) => {
        logger.log(
          `Pattern ${index + 1}: Type: ${pattern.type}, Severity: ${pattern.severity}, Details: ${pattern.details}`,
        );
      });
    } else {
      logger.log('No suspicious patterns detected');
    }

    // Test 5: Alert System
    logger.log('Test 5: Testing alert system...');

    // Send a test alert
    const alertResult = await alertService.sendAlert({
      title: 'Test Security Alert',
      message: 'This is a test alert from the Login Monitoring System',
      severity: AlertSeverity.MEDIUM,
      timestamp: new Date(),
      ipAddress: '192.168.1.1',
      email: 'admin@example.com',
      data: { source: 'test_script' },
    });
    logger.log(`Alert sent successfully: ${alertResult}`);

    // If patterns were detected, send pattern alerts
    if (patterns.length > 0) {
      for (const pattern of patterns) {
        const patternAlertResult = await alertService.sendPatternAlert(pattern);
        logger.log(`Pattern alert sent: ${patternAlertResult}`);
      }
    }

    logger.log('Login Monitoring System test completed successfully!');
    await app.close();
    process.exit(0);
  } catch (error) {
    logger.error(`Test failed: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testLoginMonitoring();
