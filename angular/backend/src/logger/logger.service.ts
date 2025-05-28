import { Injectable } from '@nestjs/common';
import * as winston from 'winston';
import * as path from 'path';

@Injectable()
export class LoggerService {
  private logger: winston.Logger;
  private readonly logsDir = 'logs';
  private readonly MAX_FILES = 7; // 7 days of logs

  constructor() {
    this.initializeLogger();
  }

  private initializeLogger() {
    // Create console format with colors for better visibility
    const consoleFormat = winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message, context, trace }) => {
        return `${timestamp} ${level} [${context || 'App'}]: ${message}${trace ? '\n' + trace : ''}`;
      }),
    );

    // File log format (unchanged)
    const fileFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYYMMDD HHmmss' }),
      winston.format.printf(({ timestamp, level, message, context, trace }) => {
        return `${timestamp} [${level.toUpperCase()}] [${context || 'App'}]: ${message}${trace ? '\n' + trace : ''}`;
      }),
    );

    // Console logger for immediate visibility
    const consoleLogger = new winston.transports.Console({
      level: process.env.DEBUG === 'true' ? 'debug' : 'info',
      format: consoleFormat,
    });

    this.logger = winston.createLogger({
      level: process.env.DEBUG === 'true' ? 'debug' : 'verbose',
      transports: [
        // Console transport for development - now with better visibility
        consoleLogger,

        // App logs
        new winston.transports.File({
          filename: path.join(this.logsDir, 'app.log'),
          level: 'verbose',
          format: fileFormat,
          maxFiles: this.MAX_FILES,
        }),
        // Error logs
        new winston.transports.File({
          filename: path.join(this.logsDir, 'error.log'),
          level: 'error',
          format: fileFormat,
          maxFiles: this.MAX_FILES,
        }),
        // Debug logs (only when DEBUG=true)
        ...(process.env.DEBUG === 'true'
          ? [
              new winston.transports.File({
                filename: path.join(this.logsDir, 'debug.log'),
                level: 'debug',
                format: fileFormat,
                maxFiles: this.MAX_FILES,
              }),
            ]
          : []),
        // Audit logs
        new winston.transports.File({
          filename: path.join(this.logsDir, 'audit.log'),
          level: 'info',
          format: fileFormat,
          maxFiles: this.MAX_FILES,
        }),
      ],
    });

    // Log startup message
    console.log('\n=== BACKEND SERVER STARTING ===\n');
  }

  log(message: string, context?: string) {
    this.logger.info(this.formatMessage(message, context));
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error(this.formatMessage(message, context));
    if (trace) {
      this.logger.error(trace);
    }
  }

  warn(message: string, context?: string) {
    this.logger.warn(this.formatMessage(message, context));
  }

  debug(message: string, context?: string) {
    this.logger.debug(this.formatMessage(message, context));
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(this.formatMessage(message, context));
  }

  audit(message: string, context?: string) {
    this.logger.info(this.formatMessage(message, 'AUDIT: ' + (context || '')));
  }

  private formatMessage(message: string, context?: string): string {
    return context ? `[${context}] ${message}` : message;
  }
}
