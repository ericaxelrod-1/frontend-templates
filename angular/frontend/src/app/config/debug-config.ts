import { environment } from '../../environments/environment';

/**
 * Debug configuration for the application
 * Controls logging levels, file output, and other debugging options
 */
export const debugConfig = {
  // Whether debugging is enabled (overridden by environment.debug if present)
  enabled: environment.production ? false : (environment.debugMode || true),
  
  // Log level: 0 = Off, 1 = Error, 2 = Warning, 3 = Info, 4 = Debug
  logLevel: environment.production ? 2 : 4,
  
  // Whether to output logs to console
  consoleOutput: environment.logging.logToConsole,
  
  // Whether to save logs to file
  fileLogging: environment.logging.logToFile,
  
  // Directory for log files (relative to the application root)
  logDirectory: 'logs',
  
  // Maximum number of log files to keep
  maxLogFiles: 10,
  
  // Maximum size of log files in bytes (5MB)
  maxLogSize: 5 * 1024 * 1024,
  
  // Log file name format
  logFileFormat: 'app-log-{date}.log',
  
  // Log file date format
  logFileDateFormat: 'YYYY-MM-DD',
  
  // Log format ('json' or 'simple')
  logFormat: 'json',
  
  // Components to enable debugging for (empty array means all components)
  enabledComponents: [] as string[],
  
  // Get whether debugging is enabled for a specific component
  isEnabledFor(componentName: string): boolean {
    // If no components specified, enable for all
    if (!this.enabledComponents || this.enabledComponents.length === 0) {
      return this.enabled;
    }
    
    // Otherwise check if this component is in the enabled list
    return this.enabledComponents.includes(componentName);
  }
};

/**
 * Export a helper function to get the appropriate log filename
 */
export function getLogFilename(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD format
  return debugConfig.logFileFormat.replace('{date}', date);
} 