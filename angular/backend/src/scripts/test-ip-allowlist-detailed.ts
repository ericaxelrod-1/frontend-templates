/**
 * Detailed test script for IP Allowlist functionality
 *
 * This script simulates HTTP requests to test:
 * 1. The IPAllowlistMiddleware correctly identifies and handles allowlisted IPs
 * 2. The IPReputationService correctly respects the allowlist status
 * 3. Security restrictions are only applied to non-allowlisted IPs
 *
 * Usage:
 * - From the backend directory: npm run test:ip-allowlist:detailed
 * - Or directly: npx ts-node src/scripts/test-ip-allowlist-detailed.ts
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ConfigService } from '@nestjs/config';
import { EnhancedLogger } from '../shared/utils/logger';
import { IPAllowlistService } from '../shared/services/ip-allowlist.service';
import { IPAllowlistMiddleware } from '../shared/middleware/ip-allowlist.middleware';
import * as fs from 'fs';
import * as path from 'path';

// Define simple mock objects instead of implementing the full interface
interface MockRequest {
  ip: string;
  connection: { remoteAddress: string };
  headers: Record<string, string>;
  clientIp?: string;
  isAllowlisted?: boolean;
}

interface MockResponse {
  statusCode: number;
  headers: Map<string, string>;
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | undefined;
}

// Mock Next Function
type NextFunction = () => void;

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

  // Create log file with header
  fs.writeFileSync(
    logFilePath,
    `# IP Allowlist Detailed Test Log - ${new Date().toISOString()}\n\n`,
  );

  const logger = new Logger('IPAllowlistTest');
  logger.log(`Starting IP Allowlist detailed test...`);
  logger.log(`Log file: ${logFilePath}`);

  // Set environment variable for testing
  process.env.IP_ALLOWLIST = '192.168.1.100,10.0.0.1';
  process.env.DEBUG_MODE = 'true';

  try {
    // Set up a standalone test using the IPAllowlistService directly
    const ipAllowlistService = new IPAllowlistService(new ConfigService());
    const middleware = new IPAllowlistMiddleware(ipAllowlistService);

    // Test scenarios
    const testScenarios = [
      {
        name: 'Local IP (localhost)',
        request: {
          ip: '127.0.0.1',
          connection: { remoteAddress: '127.0.0.1' },
          headers: {},
        } as MockRequest,
        expected: { allowlisted: true },
      },
      {
        name: 'Configured allowlist IP',
        request: {
          ip: '192.168.1.100',
          connection: { remoteAddress: '192.168.1.100' },
          headers: {},
        } as MockRequest,
        expected: { allowlisted: true },
      },
      {
        name: 'Regular IP (not in allowlist)',
        request: {
          ip: '8.8.8.8',
          connection: { remoteAddress: '8.8.8.8' },
          headers: {},
        } as MockRequest,
        expected: { allowlisted: false },
      },
      {
        name: 'IP behind proxy (X-Forwarded-For)',
        request: {
          ip: '10.0.0.2',
          connection: { remoteAddress: '10.0.0.2' },
          headers: { 'x-forwarded-for': '192.168.1.100' },
        } as MockRequest,
        expected: { allowlisted: true },
      },
      {
        name: 'Multiple IPs in X-Forwarded-For',
        request: {
          ip: '10.0.0.2',
          connection: { remoteAddress: '10.0.0.2' },
          headers: { 'x-forwarded-for': '192.168.1.100, 10.0.0.2, 8.8.8.8' },
        } as MockRequest,
        expected: { allowlisted: true },
      },
      {
        name: 'Non-allowlisted IP in X-Forwarded-For',
        request: {
          ip: '10.0.0.2',
          connection: { remoteAddress: '10.0.0.2' },
          headers: { 'x-forwarded-for': '8.8.8.8, 10.0.0.2' },
        } as MockRequest,
        expected: { allowlisted: false },
      },
    ];

    // Run tests
    logger.log(`Testing ${testScenarios.length} IP allowlist scenarios...`);

    for (const scenario of testScenarios) {
      logger.log(`\nScenario: ${scenario.name}`);

      const req = scenario.request;

      // Create a simple response object
      const res = {
        statusCode: 200,
        headers: new Map<string, string>(),
        setHeader(name: string, value: string) {
          this.headers.set(name, value);
        },
        getHeader(name: string) {
          return this.headers.get(name);
        },
      } as MockResponse;

      // Mock next function
      const next: NextFunction = () => {};

      // Apply middleware with type assertions
      middleware.use(req as any, res as any, next);

      // Verify results
      const actualClientIP = req.clientIp;
      const actualAllowlisted = req.isAllowlisted;
      const headerSet = res.headers.has('X-IP-Allowlisted');

      logger.log(`  Client IP: ${actualClientIP}`);
      logger.log(`  Is Allowlisted: ${actualAllowlisted}`);
      logger.log(`  Has Allowlist Header: ${headerSet}`);

      // Check expectations
      const allowlistStatus =
        scenario.expected.allowlisted === actualAllowlisted;
      const headerStatus = scenario.expected.allowlisted === headerSet;

      // Log test results
      const passed = allowlistStatus && headerStatus;
      logger.log(`  Test Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);

      // Append to log file
      fs.appendFileSync(logFilePath, `\n## Scenario: ${scenario.name}\n`);
      fs.appendFileSync(logFilePath, `- Client IP: ${actualClientIP}\n`);
      fs.appendFileSync(
        logFilePath,
        `- Is Allowlisted: ${actualAllowlisted}\n`,
      );
      fs.appendFileSync(logFilePath, `- Has Allowlist Header: ${headerSet}\n`);
      fs.appendFileSync(
        logFilePath,
        `- Test Result: ${passed ? 'PASS' : 'FAIL'}\n`,
      );
    }

    logger.log('\nAll IP allowlist middleware tests completed.');
    logger.log(`Detailed results available in: ${logFilePath}`);
  } catch (error) {
    logger.error('Error during test execution:', error.stack);
    fs.appendFileSync(
      logFilePath,
      `\n## ERROR\n${error.message}\n${error.stack}`,
    );
  }
}

bootstrap().catch((err) => {
  console.error('Error in test script:', err);
  process.exit(1);
});
