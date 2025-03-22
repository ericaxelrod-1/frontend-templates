/**
 * Email Service Configuration
 * 
 * This file defines the email service configuration for development and production environments.
 * For development, it uses MailDev as a local SMTP server.
 * For production, it can be configured to use a real SMTP server.
 */

// Strict validation for required environment variables in production
const getRequiredEnvVar = (name) => {
  const value = process.env[name];
  if (process.env.NODE_ENV === 'production' && !value) {
    throw new Error(`Required environment variable ${name} is missing`);
  }
  return value;
};

const config = {
  development: {
    transport: {
      host: '127.0.0.1',
      port: 1025,  // Default MailDev SMTP port
      secure: false,
      ignoreTLS: true, // No need for TLS in development
      // Disable connection pooling in development
      pool: false
    },
    defaults: {
      from: '"Angular App" <no-reply@angular-app.local>'
    },
    mailDevUI: {
      port: 1080  // Default MailDev web UI port
    },
    // Limit the number of concurrent connections
    rateLimit: {
      maxConnections: 5,
      maxMessages: 10
    },
    debug: true
  },
  production: {
    // Configure for your actual production email server
    transport: {
      host: getRequiredEnvVar('EMAIL_HOST'),
      port: parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: getRequiredEnvVar('EMAIL_USER'),
        pass: getRequiredEnvVar('EMAIL_PASSWORD')
      },
      // Enable TLS by default in production
      requireTLS: true,
      // TLS configuration
      tls: {
        // Reject unauthorized certificates
        rejectUnauthorized: true,
        // Minimum TLS version
        minVersion: 'TLSv1.2'
      },
      // Connection pooling for better performance and security
      pool: true,
      // Maximum number of connections in the pool
      maxConnections: 5,
      // Maximum messages per connection
      maxMessages: 100
    },
    defaults: {
      from: process.env.EMAIL_FROM || '"Angular App" <no-reply@yourdomain.com>'
    },
    // Limit the number of concurrent connections and messages for rate limiting
    rateLimit: {
      maxConnections: 5,
      maxMessages: 100
    },
    debug: false
  }
};

// Determine which environment to use
const environment = process.env.NODE_ENV || 'development';

// Additional validation for production config
if (environment === 'production') {
  // Validate email format
  const emailRegex = /^"?[^@]+?"?\s<[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}>$/;
  if (!emailRegex.test(config.production.defaults.from)) {
    throw new Error('Invalid EMAIL_FROM format. Must be in format: "Name" <email@domain.com>');
  }
}

module.exports = {
  ...config[environment],
  environment
}; 