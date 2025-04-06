import { Injectable } from '@angular/core';
import { debugConfig } from '../../config/debug-config';
import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { PLATFORM_ID, inject } from '@angular/core';

/**
 * Log levels enum
 */
export enum LogLevel {
  OFF = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
  TRACE = 5
}

/**
 * Interface for log entry
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

/**
 * Logger service for application-wide logging
 */
@Injectable({
  providedIn: 'root'
})
export class LoggerService {
  private level: LogLevel = LogLevel.INFO;
  protected readonly MAX_LOGS = 1000;
  protected readonly STORAGE_KEY = 'application_logs';
  protected platformId = inject(PLATFORM_ID);

  constructor() {
    this.level = debugConfig.logLevel;
    this.log(LogLevel.INFO, 'LoggerService initialized', { level: LogLevel[this.level] });
  }

  protected isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  protected isServer(): boolean {
    return isPlatformServer(this.platformId);
  }

  /**
   * Check if logging is enabled for the specified level
   */
  protected shouldLog(level: LogLevel): boolean {
    return level <= this.level && this.level !== LogLevel.OFF;
  }

  /**
   * Main log method
   */
  log(level: LogLevel, message: string, ...optionalParams: any[]): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: optionalParams.length > 0 ? this.sanitizeForStorage(optionalParams) : undefined
    };

    // Output to console if enabled
    if (debugConfig.consoleOutput) {
      this.logToConsole(entry);
    }

    // Store in memory/localStorage if in browser
    if (this.isBrowser()) {
      this.saveLog(entry);
    }

    // Write to file if in server environment and file logging is enabled
    if (this.isServer() && debugConfig.fileLogging) {
      // Server-side logging is implemented in logger.server.ts
      // This is a placeholder for the server implementation
      // The actual implementation will be provided by Angular's dependency injection
      // system when running in a server environment
      console.log('[SERVER] Would log to file:', entry);
    }
  }

  /**
   * Log to console with appropriate styling
   */
  protected logToConsole(entry: LogEntry): void {
    const logColor = this.getLogColor(entry.level);
    const logPrefix = `[${entry.timestamp}] [${LogLevel[entry.level]}]:`;

    switch (entry.level) {
      case LogLevel.ERROR:
        if (entry.data) {
          console.error(logPrefix, entry.message, entry.data);
        } else {
          console.error(logPrefix, entry.message);
        }
        break;
      case LogLevel.WARN:
        if (entry.data) {
          console.warn(logPrefix, entry.message, entry.data);
        } else {
          console.warn(logPrefix, entry.message);
        }
        break;
      case LogLevel.INFO:
      case LogLevel.DEBUG:
      case LogLevel.TRACE:
      default:
        if (entry.data) {
          console.log(`%c${logPrefix}`, `color: ${logColor}`, entry.message, entry.data);
        } else {
          console.log(`%c${logPrefix}`, `color: ${logColor}`, entry.message);
        }
        break;
    }
  }

  /**
   * Get color for log level
   */
  protected getLogColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.ERROR:
        return 'red';
      case LogLevel.WARN:
        return 'orange';
      case LogLevel.INFO:
        return 'blue';
      case LogLevel.DEBUG:
        return 'green';
      case LogLevel.TRACE:
        return 'gray';
      default:
        return 'black';
    }
  }

  /**
   * Save log to localStorage
   */
  protected saveLog(entry: LogEntry): void {
    if (!this.isBrowser()) {
      return;
    }

    try {
      // Get existing logs
      let logs: LogEntry[] = [];
      const storedLogs = localStorage.getItem(this.STORAGE_KEY);
      
      if (storedLogs) {
        logs = JSON.parse(storedLogs);
      }

      // Add new log
      logs.push(entry);

      // Enforce maximum log count
      if (logs.length > this.MAX_LOGS) {
        logs = logs.slice(logs.length - this.MAX_LOGS);
      }

      // Save back to localStorage
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(logs));
    } catch (e) {
      console.error('Failed to save log to localStorage:', e);
    }
  }

  /**
   * Sanitize data for storage
   */
  protected sanitizeForStorage(data: any): any {
    if (!data) return data;
    
    try {
      const seen = new WeakSet();
      
      return JSON.parse(JSON.stringify(data, (key, value) => {
        // Handle circular references
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular Reference]';
          }
          seen.add(value);
        }
        return value;
      }));
    } catch (e) {
      return '[Data could not be sanitized]';
    }
  }

  /**
   * Helper methods for specific log levels
   */
  trace(message: string, ...optionalParams: any[]): void {
    this.log(LogLevel.TRACE, message, ...optionalParams);
  }

  debug(message: string, ...optionalParams: any[]): void {
    this.log(LogLevel.DEBUG, message, ...optionalParams);
  }

  info(message: string, ...optionalParams: any[]): void {
    this.log(LogLevel.INFO, message, ...optionalParams);
  }

  warn(message: string, ...optionalParams: any[]): void {
    this.log(LogLevel.WARN, message, ...optionalParams);
  }

  error(message: string, ...optionalParams: any[]): void {
    this.log(LogLevel.ERROR, message, ...optionalParams);
  }

  /**
   * Get stored logs
   */
  getLogs(): LogEntry[] {
    if (!this.isBrowser()) {
      return [];
    }
    
    try {
      const storedLogs = localStorage.getItem(this.STORAGE_KEY);
      return storedLogs ? JSON.parse(storedLogs) : [];
    } catch (e) {
      console.error('Failed to retrieve logs from localStorage:', e);
      return [];
    }
  }

  /**
   * Export logs as JSON
   */
  exportLogs(): string {
    const logs = this.getLogs();
    return JSON.stringify(logs, null, 2);
  }

  /**
   * Clear stored logs
   */
  clearLogs(): void {
    if (!this.isBrowser()) {
      return;
    }
    
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      this.info('Logs cleared');
    } catch (e) {
      console.error('Failed to clear logs from localStorage:', e);
    }
  }
} 