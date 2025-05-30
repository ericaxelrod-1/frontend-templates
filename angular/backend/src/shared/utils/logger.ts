import { Logger, LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Enhanced logger with file logging capabilities.
 * Extends the NestJS Logger with additional features.
 */
export class EnhancedLogger extends Logger {
  private static configService: ConfigService;
  private static debugMode: boolean = false;
  private static logToFile: boolean = false;
  private static logDir: string = 'logs';
  private static logFilePath: string;

  static initialize(configService: ConfigService) {
    this.configService = configService;
    this.debugMode =
      configService.get<string>('DEBUG_MODE', 'false').toLowerCase() === 'true';
    this.logToFile =
      configService.get<string>('LOG_TO_FILE', 'false').toLowerCase() ===
      'true';
    this.logDir = configService.get<string>('LOG_DIR', 'logs');

    if (this.logToFile) {
      this.ensureLogDirectoryExists();
      const timestamp = new Date()
        .toISOString()
        .replace(/:/g, '-')
        .split('.')[0];
      this.logFilePath = path.join(this.logDir, `app-${timestamp}.log`);
    }

    Logger.log(
      `Debug mode: ${this.debugMode ? 'ENABLED' : 'DISABLED'}`,
      'EnhancedLogger',
    );
    if (this.logToFile) {
      Logger.log(
        `File logging enabled. Log file: ${this.logFilePath}`,
        'EnhancedLogger',
      );
    }
  }

  private static ensureLogDirectoryExists() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private static writeToLogFile(message: any, context?: string) {
    if (!this.logToFile || !this.logFilePath) return;

    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${context || 'App'}] ${message}\n`;

    fs.appendFileSync(this.logFilePath, formattedMessage);
  }

  /**
   * Log a debug message (only in debug mode)
   * @param message The message to log
   * @param context Optional context
   */
  debug(message: any, context?: string) {
    if (EnhancedLogger.debugMode) {
      super.debug(message, context);
      EnhancedLogger.writeToLogFile(`[DEBUG] ${message}`, context);
    }
  }

  /**
   * Log an informational message
   * @param message The message to log
   * @param context Optional context
   */
  log(message: any, context?: string) {
    super.log(message, context);
    EnhancedLogger.writeToLogFile(`[INFO] ${message}`, context);
  }

  /**
   * Log a warning message
   * @param message The message to log
   * @param context Optional context
   */
  warn(message: any, context?: string) {
    super.warn(message, context);
    EnhancedLogger.writeToLogFile(`[WARN] ${message}`, context);
  }

  /**
   * Log an error message
   * @param message The message to log
   * @param trace Optional stack trace
   * @param context Optional context
   */
  error(message: any, trace?: string, context?: string) {
    super.error(message, trace, context);
    EnhancedLogger.writeToLogFile(
      `[ERROR] ${message}${trace ? `\n${trace}` : ''}`,
      context,
    );
  }

  /**
   * Log a verbose message (only in debug mode)
   * @param message The message to log
   * @param context Optional context
   */
  verbose(message: any, context?: string) {
    if (EnhancedLogger.debugMode) {
      super.verbose(message, context);
      EnhancedLogger.writeToLogFile(`[VERBOSE] ${message}`, context);
    }
  }
}
