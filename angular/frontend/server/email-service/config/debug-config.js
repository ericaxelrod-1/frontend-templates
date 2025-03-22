/**
 * Email Service Debug Configuration
 * 
 * This file defines the debug configuration for the email service.
 * It controls logging behavior for development and testing purposes.
 * 
 * Usage:
 * - Set process.env.DEBUG=true to enable debug mode
 * - Set process.env.DEBUG_LOG_FILE=true to enable file logging
 * - Configure log file paths and other options below
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Default debug configuration
const debugConfig = {
  // Enable debug mode - can be overridden with process.env.DEBUG
  enabled: process.env.DEBUG === 'true',
  
  // Enable console output
  consoleOutput: true,
  
  // Enable file logging - can be overridden with process.env.DEBUG_LOG_FILE
  fileLogging: process.env.DEBUG_LOG_FILE === 'true',
  
  // Log directory - defaults to 'logs' in the email-service directory
  logDirectory: process.env.DEBUG_LOG_DIR || path.join(__dirname, '..', 'logs'),
  
  // Log filename format - defaults to email-service-YYYY-MM-DD.log
  logFileFormat: 'email-service-{date}.log',
  
  // Log level (1: errors only, 2: warnings, 3: info, 4: verbose)
  logLevel: parseInt(process.env.DEBUG_LOG_LEVEL || '3', 10),
  
  // Log email content (may contain sensitive information)
  logEmailContent: process.env.DEBUG_LOG_EMAIL_CONTENT === 'true' || false,
  
  // Maximum log file size in bytes before rotation (default: 5MB)
  maxLogSize: parseInt(process.env.DEBUG_MAX_LOG_SIZE || '5242880', 10),
  
  // Maximum number of log files to keep
  maxLogFiles: parseInt(process.env.DEBUG_MAX_LOG_FILES || '5', 10),
  
  // Log format (simple, detailed, json)
  logFormat: process.env.DEBUG_LOG_FORMAT || 'detailed'
};

// Create the log directory if it doesn't exist and file logging is enabled
if (debugConfig.fileLogging && !fs.existsSync(debugConfig.logDirectory)) {
  try {
    fs.mkdirSync(debugConfig.logDirectory, { recursive: true });
  } catch (error) {
    console.error(`Failed to create log directory: ${error.message}`);
    // Fallback to system temp directory if creation fails
    debugConfig.logDirectory = path.join(os.tmpdir(), 'email-service-logs');
    if (!fs.existsSync(debugConfig.logDirectory)) {
      fs.mkdirSync(debugConfig.logDirectory, { recursive: true });
    }
  }
}

// Helper function to get today's log filename
const getLogFilename = () => {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return debugConfig.logFileFormat.replace('{date}', date);
};

// Logger function that handles both console and file logging
const logger = {
  /**
   * Log a message at the specified level
   * @param {string} level - The log level (error, warn, info, debug)
   * @param {string} message - The message to log
   * @param {Object} [data] - Optional data to include in the log
   */
  log(level, message, data = null) {
    if (!debugConfig.enabled) return;
    
    // Check log level
    const levelMap = { error: 1, warn: 2, info: 3, debug: 4 };
    const numericLevel = levelMap[level] || 3;
    
    if (numericLevel > debugConfig.logLevel) return;
    
    const timestamp = new Date().toISOString();
    let logMessage;
    
    // Format the log message based on the configured format
    if (debugConfig.logFormat === 'json') {
      logMessage = JSON.stringify({
        timestamp,
        level,
        message,
        data: data || undefined
      });
    } else if (debugConfig.logFormat === 'simple') {
      logMessage = `[${level.toUpperCase()}] ${message}`;
    } else {
      // detailed format
      logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
      if (data) {
        // Sanitize sensitive data if needed
        let logData = data;
        if (!debugConfig.logEmailContent && data.emailContent) {
          logData = { ...data };
          logData.emailContent = '[REDACTED]';
        }
        
        logMessage += `\n${JSON.stringify(logData, null, 2)}`;
      }
    }
    
    // Console output
    if (debugConfig.consoleOutput) {
      const consoleMethod = level === 'error' ? 'error' : 
                           level === 'warn' ? 'warn' : 'log';
      console[consoleMethod](logMessage);
    }
    
    // File logging
    if (debugConfig.fileLogging) {
      try {
        const logPath = path.join(debugConfig.logDirectory, getLogFilename());
        
        // Check file size for rotation
        if (fs.existsSync(logPath)) {
          const stats = fs.statSync(logPath);
          if (stats.size > debugConfig.maxLogSize) {
            rotateLogFiles();
          }
        }
        
        // Append to log file
        fs.appendFileSync(logPath, logMessage + '\n');
      } catch (error) {
        console.error(`Failed to write to log file: ${error.message}`);
      }
    }
  },
  
  // Convenience methods for different log levels
  error(message, data) { this.log('error', message, data); },
  warn(message, data) { this.log('warn', message, data); },
  info(message, data) { this.log('info', message, data); },
  debug(message, data) { this.log('debug', message, data); }
};

// Helper function to rotate log files
function rotateLogFiles() {
  try {
    const baseFilename = getLogFilename().replace('.log', '');
    const logFiles = fs.readdirSync(debugConfig.logDirectory)
      .filter(file => file.startsWith(baseFilename))
      .sort();
    
    // Remove oldest log files if we have too many
    while (logFiles.length >= debugConfig.maxLogFiles) {
      const oldestFile = logFiles.shift();
      fs.unlinkSync(path.join(debugConfig.logDirectory, oldestFile));
    }
    
    // Rename current log file to baseFilename.1.log
    const currentLog = path.join(debugConfig.logDirectory, getLogFilename());
    if (fs.existsSync(currentLog)) {
      const newName = path.join(debugConfig.logDirectory, `${baseFilename}.1.log`);
      fs.renameSync(currentLog, newName);
    }
  } catch (error) {
    console.error(`Failed to rotate log files: ${error.message}`);
  }
}

module.exports = {
  config: debugConfig,
  logger
}; 