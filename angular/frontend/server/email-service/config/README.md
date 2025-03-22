# Email Service Configuration

This directory contains configuration files for the Email Service.

## Files

- `email-config.js` - Core email service configuration for different environments
- `debug-config.js` - Debug and logging configuration

## Debug Configuration

The debug configuration provides comprehensive logging capabilities for the email service, including:

- Console logging
- File logging with rotation
- Multiple log levels
- Sensitive data protection

### Usage

To enable debug mode, set the `DEBUG` environment variable to `true`:

```
DEBUG=true node your-script.js
```

To enable file logging along with debug mode:

```
DEBUG=true DEBUG_LOG_FILE=true node your-script.js
```

Or enable debug logging via code:

```javascript
process.env.DEBUG = 'true';
process.env.DEBUG_LOG_FILE = 'true';
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| DEBUG | Enable debug mode | false |
| DEBUG_LOG_FILE | Enable file logging | false |
| DEBUG_LOG_DIR | Log directory | `[email-service]/logs` |
| DEBUG_LOG_LEVEL | Log level (1-4) | 3 |
| DEBUG_LOG_EMAIL_CONTENT | Include email content in logs | false |
| DEBUG_MAX_LOG_SIZE | Max log file size in bytes | 5242880 (5MB) |
| DEBUG_MAX_LOG_FILES | Number of log files to keep | 5 |
| DEBUG_LOG_FORMAT | Log format (simple, detailed, json) | detailed |

### Log Levels

1. **Error** - Critical errors only
2. **Warning** - Warnings and errors
3. **Info** - General information, warnings, and errors
4. **Debug** - Detailed debugging information

### File Logging

When file logging is enabled, logs are written to the configured log directory with the format `email-service-YYYY-MM-DD.log`. Log files are automatically rotated when they reach the configured maximum size.

### Logger Usage

```javascript
const { logger } = require('./config/debug-config');

// Different log levels
logger.error('Critical error occurred', { error: 'details' });
logger.warn('Warning message');
logger.info('Information message');
logger.debug('Detailed debug information', { data: 'values' });

// Generic logging with level
logger.log('info', 'Message', { optional: 'data' });
```

### Security Considerations

- Sensitive data like email contents and credentials are redacted from logs by default
- To include email content in logs (for debugging only), set `DEBUG_LOG_EMAIL_CONTENT=true`
- In production, it's recommended to keep debug mode disabled and file logging disabled 