import { Injectable } from '@angular/core';
import { LoggerService, LogEntry, LogLevel } from './logger.service';
import { debugConfig, getLogFilename } from '../../config/debug-config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Server-side implementation of the LoggerService
 * This will be used when running in a Node.js environment
 */
@Injectable()
export class ServerLoggerService extends LoggerService {
  /**
   * Override the log method to add server-specific logging
   */
  override log(level: LogLevel, message: string, ...optionalParams: any[]): void {
    // Call the parent log method first
    super.log(level, message, ...optionalParams);

    // Then handle the file logging for the server
    if (debugConfig.fileLogging && level <= debugConfig.logLevel) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        data: optionalParams.length > 0 ? this.sanitizeForStorage(optionalParams) : undefined
      };

      this.writeToLogFile(entry);
    }
  }

  /**
   * Write log to file (server-side only)
   */
  private writeToLogFile(entry: LogEntry): void {
    try {
      // Make sure the log directory exists
      const logDir = debugConfig.logDirectory;
      
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const logFile = path.join(logDir, getLogFilename());
      
      // Check if we need to rotate logs
      this.checkLogFileSize(logFile);
      
      // Format the log entry
      let logText = '';
      if (debugConfig.logFormat === 'json') {
        try {
          // Use sanitized data to avoid circular references
          logText = JSON.stringify(entry) + '\n';
        } catch (err) {
          // If JSON stringify fails, fall back to a simpler format
          logText = `[${entry.timestamp}] [${LogLevel[entry.level]}]: ${entry.message}\n`;
        }
      } else {
        // Plain text format
        logText = `[${entry.timestamp}] [${LogLevel[entry.level]}]: ${entry.message}`;
        if (entry.data) {
          try {
            logText += ` ${JSON.stringify(entry.data)}`;
          } catch (err) {
            logText += ' [DATA_STRINGIFICATION_ERROR]';
          }
        }
        logText += '\n';
      }
      
      // Append to log file
      fs.appendFileSync(logFile, logText);
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }
  }

  /**
   * Check if log file needs rotation
   */
  private checkLogFileSize(logFile: string): void {
    try {
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        const fileSizeInBytes = stats.size;
        const fileSizeInMB = fileSizeInBytes / (1024 * 1024);
        
        if (fileSizeInMB > debugConfig.maxLogSize) {
          // Rotate log files
          const logDir = debugConfig.logDirectory;
          const files = fs.readdirSync(logDir)
            .filter((f: string) => f.startsWith('app.log.'))
            .sort()
            .reverse();
          
          // Delete oldest log if we have too many
          while (files.length >= debugConfig.maxLogFiles) {
            fs.unlinkSync(`${logDir}/${files.pop()}`);
          }
          
          // Rename current log file
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          fs.renameSync(logFile, `${logDir}/app.log.${timestamp}`);
        }
      }
    } catch (err) {
      console.error('Failed to check log file size:', err);
    }
  }

  /**
   * Sanitize data for storage
   */
  private sanitizeForStorage(data: any): any {
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
} 