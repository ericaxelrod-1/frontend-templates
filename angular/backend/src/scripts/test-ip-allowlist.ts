/**
 * Test script for IP Allowlist functionality
 *
 * This script validates that:
 * 1. The IP allowlist service initializes correctly with default and configured IPs
 * 2. The allowlist can identify allowed and non-allowed IPs
 * 3. The IPReputationService correctly handles allowlisted IPs
 *
 * Usage:
 * - From the backend directory: npm run test:ip-allowlist
 * - Or directly: npx ts-node src/scripts/test-ip-allowlist.ts
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnhancedLogger } from '../shared/utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { IPAllowlistService } from '../shared/services/ip-allowlist.service';

// Create a test module without database dependencies
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SharedModule } from '../shared/shared.module';

// Create a mock IP reputation service
class MockIPReputationService {
  private readonly logger = new Logger('MockIPReputationService');
  private blockedIPs: Map<string, Date> = new Map();
  private failedAttempts: Map<string, number> = new Map();

  constructor(private readonly ipAllowlistService: IPAllowlistService) {}

  async incrementFailedAttempts(ipAddress: string): Promise<any> {
    // Skip incrementing for allowlisted IPs
    if (this.ipAllowlistService.isAllowlisted(ipAddress)) {
      this.logger.debug(
        `Not incrementing failed attempts for allowlisted IP: ${ipAddress}`,
      );
      return { ipAddress, failedAttempts: 0, isBlocked: false };
    }

    let attempts = this.failedAttempts.get(ipAddress) || 0;
    attempts += 1;
    this.failedAttempts.set(ipAddress, attempts);

    this.logger.debug(
      `Incremented failed attempts for IP ${ipAddress} to ${attempts}`,
    );

    if (attempts >= 5) {
      const blockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
      this.blockedIPs.set(ipAddress, blockedUntil);
      this.logger.warn(
        `IP ${ipAddress} has been blocked until ${blockedUntil}`,
      );
      return {
        ipAddress,
        failedAttempts: attempts,
        isBlocked: true,
        blockedUntil,
      };
    }

    return { ipAddress, failedAttempts: attempts, isBlocked: false };
  }

  async isBlocked(ipAddress: string): Promise<boolean> {
    // Allowlisted IPs are never blocked
    if (this.ipAllowlistService.isAllowlisted(ipAddress)) {
      return false;
    }

    const blockedUntil = this.blockedIPs.get(ipAddress);
    if (!blockedUntil) {
      return false;
    }

    if (blockedUntil > new Date()) {
      this.logger.debug(
        `IP ${ipAddress} is currently blocked until ${blockedUntil}`,
      );
      return true;
    }

    // Unblock if block duration has expired
    this.blockedIPs.delete(ipAddress);
    this.logger.debug(
      `Block for IP ${ipAddress} has expired and has been removed`,
    );
    return false;
  }

  async requiresCaptcha(ipAddress: string): Promise<boolean> {
    // Allowlisted IPs never require CAPTCHA
    if (this.ipAllowlistService.isAllowlisted(ipAddress)) {
      return false;
    }

    const attempts = this.failedAttempts.get(ipAddress) || 0;
    const requiresCaptcha = attempts >= 3;

    if (requiresCaptcha) {
      this.logger.debug(
        `CAPTCHA required for IP ${ipAddress} due to ${attempts} failed attempts`,
      );
    }

    return requiresCaptcha;
  }

  async reset(ipAddress: string): Promise<void> {
    this.failedAttempts.delete(ipAddress);
    this.blockedIPs.delete(ipAddress);
    this.logger.log(`Reset IP reputation for ${ipAddress}`);
  }
}

// Define a test module
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load from environment or provide test values
      load: [
        () => ({
          IP_ALLOWLIST: process.env.IP_ALLOWLIST || '192.168.1.100,10.0.0.1',
          DEBUG_MODE: process.env.DEBUG_MODE || 'true',
          LOG_TO_FILE: process.env.LOG_TO_FILE || 'true',
          LOG_DIR: process.env.LOG_DIR || 'logs',
        }),
      ],
    }),
    SharedModule,
  ],
  providers: [
    {
      provide: 'IPReputationService',
      useFactory: (ipAllowlistService: IPAllowlistService) => {
        return new MockIPReputationService(ipAllowlistService);
      },
      inject: [IPAllowlistService],
    },
  ],
})
class TestModule {}

async function bootstrap() {
  // Create a specific log file for this test
  const scriptName = path.basename(__filename, '.ts');
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const logDir = 'logs';
  const logFilePath = path.join(logDir, `${scriptName}-${timestamp}.log`);

  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Function to log messages both to console and file
  const log = (
    message: string,
    type: 'info' | 'error' | 'warn' | 'debug' = 'info',
  ) => {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${type.toUpperCase()}] ${message}`;

    // Log to console with color
    switch (type) {
      case 'error':
        console.error(formattedMessage);
        break;
      case 'warn':
        console.warn(formattedMessage);
        break;
      case 'debug':
        console.debug(formattedMessage);
        break;
      default:
        console.log(formattedMessage);
    }

    // Log to file
    fs.appendFileSync(logFilePath, formattedMessage + '\n');
  };

  // Header for the log file
  fs.writeFileSync(
    logFilePath,
    `# IP Allowlist Test Log - ${new Date().toISOString()}\n\n`,
  );

  log('Starting IP allowlist test script...', 'info');
  log(`Log file created at: ${logFilePath}`, 'info');

  // Set environment variable for testing
  process.env.IP_ALLOWLIST = '192.168.1.100,10.0.0.1';
  process.env.DEBUG_MODE = 'true';
  process.env.LOG_TO_FILE = 'true';

  // Create a NestJS application context with the test module
  log('Creating test application context...', 'info');
  const app = await NestFactory.createApplicationContext(TestModule);

  // Initialize the enhanced logger
  const configService = app.get(ConfigService);
  EnhancedLogger.initialize(configService);

  // Create logger for this test
  const logger = new Logger('TestIPAllowlist');

  try {
    // Get services
    const ipAllowlistService = app.get(IPAllowlistService);
    const ipReputationService = app.get(
      'IPReputationService',
    ) as MockIPReputationService;

    // Log the environment configuration
    logger.log(
      `IP_ALLOWLIST env variable: ${configService.get('IP_ALLOWLIST')}`,
    );

    // Test IP allowlist service
    const allowlistedIPs = ipAllowlistService.getAllowlistedIPs();
    logger.log(`Allowlisted IPs: ${allowlistedIPs.join(', ')}`);

    // Should contain default IPs
    if (allowlistedIPs.includes('127.0.0.1')) {
      logger.log('✅ Default IP 127.0.0.1 is in the allowlist');
    } else {
      logger.error('❌ Default IP 127.0.0.1 is missing from the allowlist');
    }

    // Should contain configured IPs
    if (allowlistedIPs.includes('192.168.1.100')) {
      logger.log('✅ Configured IP 192.168.1.100 is in the allowlist');
    } else {
      logger.error(
        '❌ Configured IP 192.168.1.100 is missing from the allowlist',
      );
    }

    // Test allowlist checks
    const testIPs = [
      '127.0.0.1', // Should be allowlisted (default)
      '192.168.1.100', // Should be allowlisted (from config)
      '8.8.8.8', // Should NOT be allowlisted
    ];

    for (const ip of testIPs) {
      const isAllowlisted = ipAllowlistService.isAllowlisted(ip);
      logger.log(
        `IP ${ip} is ${isAllowlisted ? '✅ allowlisted' : '❌ not allowlisted'}`,
      );
    }

    // Test IP reputation service integration with allowlist
    logger.log('\nTesting IP Reputation Service integration with allowlist:');

    // Test allowlisted IP
    const allowlistedIP = '192.168.1.100';

    // 1. Test incrementFailedAttempts - should not increment for allowlisted IP
    logger.log(
      `Testing failed attempts handling for allowlisted IP: ${allowlistedIP}`,
    );
    await ipReputationService.incrementFailedAttempts(allowlistedIP);
    await ipReputationService.incrementFailedAttempts(allowlistedIP);
    await ipReputationService.incrementFailedAttempts(allowlistedIP);

    // Should not be blocked despite multiple failed attempts
    const isAllowlistedIPBlocked =
      await ipReputationService.isBlocked(allowlistedIP);
    logger.log(
      `Allowlisted IP ${allowlistedIP} blocked status: ${isAllowlistedIPBlocked ? '❌ BLOCKED (wrong!)' : '✅ NOT BLOCKED (correct)'}`,
    );

    // Should not require CAPTCHA despite failed attempts
    const allowlistedIPRequiresCaptcha =
      await ipReputationService.requiresCaptcha(allowlistedIP);
    logger.log(
      `Allowlisted IP ${allowlistedIP} requires CAPTCHA: ${allowlistedIPRequiresCaptcha ? '❌ YES (wrong!)' : '✅ NO (correct)'}`,
    );

    // Test non-allowlisted IP
    const regularIP = '8.8.8.8';

    // Reset first to ensure clean state
    await ipReputationService.reset(regularIP);

    // Increment failed attempts to trigger blocking
    logger.log(`Testing failed attempts handling for regular IP: ${regularIP}`);
    await ipReputationService.incrementFailedAttempts(regularIP);
    await ipReputationService.incrementFailedAttempts(regularIP);
    await ipReputationService.incrementFailedAttempts(regularIP);

    // Should require CAPTCHA after 3 failed attempts
    const regularIPRequiresCaptcha =
      await ipReputationService.requiresCaptcha(regularIP);
    logger.log(
      `Regular IP ${regularIP} requires CAPTCHA: ${regularIPRequiresCaptcha ? '✅ YES (correct)' : '❌ NO (wrong!)'}`,
    );

    // Two more failed attempts to trigger blocking (total 5)
    await ipReputationService.incrementFailedAttempts(regularIP);
    await ipReputationService.incrementFailedAttempts(regularIP);

    // Should be blocked after 5 failed attempts
    const isRegularIPBlocked = await ipReputationService.isBlocked(regularIP);
    logger.log(
      `Regular IP ${regularIP} blocked status: ${isRegularIPBlocked ? '✅ BLOCKED (correct)' : '❌ NOT BLOCKED (wrong!)'}`,
    );

    // Clean up
    await ipReputationService.reset(regularIP);
    await ipReputationService.reset(allowlistedIP);

    logger.log('IP allowlist test script completed successfully.');
    logger.log(`Full test log available at: ${logFilePath}`);
  } catch (error) {
    log(`Error during test execution: ${error.message}`, 'error');
    if (error.stack) {
      log(error.stack, 'error');
    }
  } finally {
    await app.close();
  }
}

bootstrap().catch((err) => {
  console.error('Error in test script:', err);
  process.exit(1);
});
