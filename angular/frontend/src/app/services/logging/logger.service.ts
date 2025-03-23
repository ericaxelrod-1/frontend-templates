import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { PLATFORM_ID, inject } from '@angular/core';

export enum LogLevel {
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error'
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

@Injectable({
  providedIn: 'root'
})
export class LoggerService {
  private config = environment.logging;
  private platformId = inject(PLATFORM_ID);
  private isBrowser: boolean;
  private isServer: boolean;
  private readonly LOCAL_STORAGE_KEY = 'app_logs';
  private readonly MAX_LOGS = 1000;

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.isServer = isPlatformServer(this.platformId);
    
    if (this.config?.enabled) {
      this.info('Logger service initialized', { 
        browser: this.isBrowser, 
        server: this.isServer,
        logLevel: this.config.logLevel,
        logToConsole: this.config.logToConsole,
        logToFile: this.config.logToFile
      });
    }
  }

  debug(message: string, ...optionalParams: any[]): void {
    this.log(LogLevel.Debug, message, ...optionalParams);
  }

  info(message: string, ...optionalParams: any[]): void {
    this.log(LogLevel.Info, message, ...optionalParams);
  }

  warn(message: string, ...optionalParams: any[]): void {
    this.log(LogLevel.Warn, message, ...optionalParams);
  }

  error(message: string, ...optionalParams: any[]): void {
    this.log(LogLevel.Error, message, ...optionalParams);
  }

  private getLogLevelValue(level: LogLevel): number {
    switch (level) {
      case LogLevel.Debug: return 0;
      case LogLevel.Info: return 1;
      case LogLevel.Warn: return 2;
      case LogLevel.Error: return 3;
      default: return 1;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config?.enabled) return false;
    
    const configLevel = this.config.logLevel || LogLevel.Info;
    return this.getLogLevelValue(level) >= this.getLogLevelValue(configLevel as LogLevel);
  }

  private log(level: LogLevel, message: string, ...optionalParams: any[]): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    // Create an object to store the log
    const logEntry: LogEntry = {
      timestamp,
      level,
      message,
      data: optionalParams.length ? optionalParams : undefined
    };
    
    // If in browser and log to console is enabled
    if (this.isBrowser && this.config?.logToConsole) {
      switch (level) {
        case LogLevel.Debug:
          console.debug(formattedMessage, ...optionalParams);
          break;
        case LogLevel.Info:
          console.info(formattedMessage, ...optionalParams);
          break;
        case LogLevel.Warn:
          console.warn(formattedMessage, ...optionalParams);
          break;
        case LogLevel.Error:
          console.error(formattedMessage, ...optionalParams);
          break;
      }
      
      // Store logs in localStorage for browser debugging if needed
      if (this.config.logToFile) {
        this.saveLogToStorage(logEntry);
      }
    }
    
    // If in server environment, additional server-side logging could be implemented here
    if (this.isServer && this.config?.logToFile) {
      // In server environments, we would use a different approach to log to files
      // This would typically be handled by a server-side logging framework
      console.log(formattedMessage, ...optionalParams);
    }
  }
  
  private saveLogToStorage(logEntry: LogEntry): void {
    if (!this.isBrowser) return;
    
    try {
      const logs = this.getStoredLogs();
      logs.push(logEntry);
      
      // Keep only the last MAX_LOGS entries
      if (logs.length > this.MAX_LOGS) {
        logs.splice(0, logs.length - this.MAX_LOGS);
      }
      
      localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(logs));
    } catch (e) {
      console.error('Failed to store log in localStorage', e);
    }
  }
  
  private getStoredLogs(): LogEntry[] {
    if (!this.isBrowser) return [];
    
    try {
      const storedLogs = localStorage.getItem(this.LOCAL_STORAGE_KEY);
      return storedLogs ? JSON.parse(storedLogs) : [];
    } catch (e) {
      console.error('Failed to retrieve logs from localStorage', e);
      return [];
    }
  }
  
  // Helper method to export logs from the browser (useful for debugging)
  exportLogs(): string {
    if (this.isBrowser) {
      return JSON.stringify(this.getStoredLogs());
    }
    return '[]';
  }
  
  // Clear logs from localStorage
  clearLogs(): void {
    if (this.isBrowser) {
      try {
        localStorage.removeItem(this.LOCAL_STORAGE_KEY);
      } catch (e) {
        console.error('Failed to clear logs', e);
      }
    }
  }
} 