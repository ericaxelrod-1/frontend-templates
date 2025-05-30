import { Test, TestingModule } from '@nestjs/testing';
import { LoggerService } from './logger.service';
import * as fs from 'fs';
import * as path from 'path';

describe('LoggerService', () => {
  let service: LoggerService;
  const logsDir = path.join(process.cwd(), 'logs');
  const testFiles = ['app.log', 'error.log', 'audit.log'];
  const debugFile = 'debug.log';

  beforeEach(async () => {
    // Clear environment
    delete process.env.DEBUG;

    // Ensure logs directory exists
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [LoggerService],
    }).compile();

    service = module.get<LoggerService>(LoggerService);
  });

  afterEach(async () => {
    // Clean up log files after each test
    for (const file of testFiles) {
      const filePath = path.join(logsDir, file);
      try {
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
        }
      } catch (error) {
        console.warn(`Could not delete ${filePath}: ${error.message}`);
      }
    }

    // Clean up debug log if it exists
    const debugPath = path.join(logsDir, debugFile);
    try {
      if (fs.existsSync(debugPath)) {
        await fs.promises.unlink(debugPath);
      }
    } catch (error) {
      console.warn(`Could not delete ${debugPath}: ${error.message}`);
    }
  });

  afterAll(async () => {
    // Remove logs directory after all tests
    try {
      if (fs.existsSync(logsDir)) {
        await fs.promises.rmdir(logsDir);
      }
    } catch (error) {
      console.warn(`Could not remove logs directory: ${error.message}`);
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create log files when logging messages', async () => {
    service.log('test info message');
    service.error('test error message');
    service.audit('test audit message');

    // Give the file system a moment to write the files - increase timeout
    await new Promise((resolve) => setTimeout(resolve, 1000));

    for (const file of testFiles) {
      expect(fs.existsSync(path.join(logsDir, file))).toBeTruthy();
    }
  });

  it('should not create debug log file when DEBUG is false', async () => {
    service.debug('test debug message');

    // Give the file system a moment to write the files
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(fs.existsSync(path.join(logsDir, debugFile))).toBeFalsy();
  });

  it('should create debug log file when DEBUG is true', async () => {
    process.env.DEBUG = 'true';
    // Reinitialize service to pick up DEBUG env var
    service = new LoggerService();

    service.debug('test debug message');

    // Give the file system a moment to write the files
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(fs.existsSync(path.join(logsDir, debugFile))).toBeTruthy();
  });

  it('should format messages with context correctly', async () => {
    const testMessage = 'test message';
    const testContext = 'TestContext';
    service.log(testMessage, testContext);

    // Give the file system a moment to write the files
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const logContent = await fs.promises.readFile(
      path.join(logsDir, 'app.log'),
      'utf8',
    );
    expect(logContent).toContain(`[${testContext}]`);
    expect(logContent).toContain(testMessage);
  });

  it('should include stack traces in error logs', async () => {
    const testMessage = 'test error';
    const testTrace = 'Error: test stack trace';
    service.error(testMessage, testTrace);

    // Give the file system a moment to write the files
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const logContent = await fs.promises.readFile(
      path.join(logsDir, 'error.log'),
      'utf8',
    );
    expect(logContent).toContain(testMessage);
    expect(logContent).toContain(testTrace);
  });

  it('should format audit logs with AUDIT prefix', async () => {
    const testMessage = 'test audit';
    const testContext = 'TestContext';
    service.audit(testMessage, testContext);

    // Give the file system a moment to write the files
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const logContent = await fs.promises.readFile(
      path.join(logsDir, 'audit.log'),
      'utf8',
    );
    expect(logContent).toContain('AUDIT:');
    expect(logContent).toContain(testContext);
    expect(logContent).toContain(testMessage);
  });

  it('should include timestamp in log messages', async () => {
    service.log('test message');

    // Give the file system a moment to write the files
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const logContent = await fs.promises.readFile(
      path.join(logsDir, 'app.log'),
      'utf8',
    );

    // Timestamp format: YYYYMMDD HHmmss
    const timestampRegex = /\d{8}\s\d{6}/;
    expect(logContent).toMatch(timestampRegex);
  });

  it('should handle warning messages correctly', async () => {
    const testMessage = 'test warning';
    service.warn(testMessage);

    // Give the file system a moment to write the files
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const logContent = await fs.promises.readFile(
      path.join(logsDir, 'app.log'),
      'utf8',
    );
    expect(logContent).toContain('[WARN]');
    expect(logContent).toContain(testMessage);
  });

  it('should handle verbose messages correctly', async () => {
    const testMessage = 'test verbose';
    service.verbose(testMessage);

    // Give the file system a moment to write the files
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const logContent = await fs.promises.readFile(
      path.join(logsDir, 'app.log'),
      'utf8',
    );
    expect(logContent).toContain('[VERBOSE]');
    expect(logContent).toContain(testMessage);
  });
});
