# Email Service Documentation

This document provides detailed information about the email service implementation in the Angular application.

## Overview

The email service provides functionality for sending emails from the application, particularly for features such as password reset. The implementation uses:

1. **Nodemailer**: A module for Node.js applications to allow easy email sending.
2. **MailDev**: A local SMTP server and web interface for testing and development.

## Architecture

The email service is structured as follows:

```
server/
└── email-service/
    ├── config/
    │   └── email-config.js          # Configuration for different environments
    ├── templates/
    │   └── password-reset.html      # HTML email template for password reset
    ├── email-service.js             # Main service implementation
    └── start-maildev.js             # Script to start the MailDev server
```

## Dependency Details

### Nodemailer

- **Version**: 6.9.12
- **Purpose**: Sending emails via SMTP from Node.js
- **Alternatives Considered**:
  - SendGrid SDK: Not selected to avoid dependency on external service for development
  - AWS SES SDK: Not selected as it requires AWS account and is more complex for simple use cases
- **Documentation**: https://nodemailer.com/
- **License**: MIT
- **Research Findings**:
  - Stable and widely adopted library with over 15M weekly downloads
  - Active maintenance with regular updates
  - Compatible with various SMTP providers
  - Simple API with good documentation
- **Security Status**: No known vulnerabilities
- **Last Verified**: 2025-03-22

### MailDev

- **Version**: 2.2.1
- **Purpose**: Local SMTP server and web interface for email testing during development
- **Alternatives Considered**:
  - MailHog: Not selected as MailDev has better Node.js integration
  - MailSlurper: Not selected due to smaller community and less active development
- **Documentation**: https://github.com/maildev/maildev
- **License**: MIT
- **Research Findings**:
  - Cross-platform email testing tool
  - Provides both SMTP server and web UI for viewing emails
  - Simple to integrate with Node.js applications
  - Previously had vulnerabilities that were addressed in version 2.2.1
- **Security Status**: Fixed vulnerabilities from previous versions
- **Last Verified**: 2025-03-22

## Configuration

The email service configuration is defined in `server/email-service/config/email-config.js` and supports two environments:

### Development
```javascript
{
  transport: {
    host: '127.0.0.1',
    port: 1025,  // Default MailDev SMTP port
    secure: false,
    ignoreTLS: true
  },
  defaults: {
    from: '"Angular App" <no-reply@angular-app.local>'
  },
  mailDevUI: {
    port: 1080  // Default MailDev web UI port
  },
  debug: true
}
```

### Production
```javascript
{
  transport: {
    host: 'smtp.yourdomain.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  },
  defaults: {
    from: '"Angular App" <no-reply@yourdomain.com>'
  },
  debug: false
}
```

## Usage

### Starting the Development Email Environment

To start the MailDev server and the application together:

```bash
npm run start:email-dev
```

This command will:
1. Start the MailDev server on SMTP port 1025 and web UI port 1080
2. Start the Angular application with server-side rendering

### Viewing Test Emails

During development, all sent emails can be viewed in the MailDev web interface at:
- http://localhost:1080

### Implementing Email Functionality

The email service provides the following main methods:

#### `sendEmail(options)`
Send a generic email with the following options:
- `to`: Recipient email address
- `subject`: Email subject
- `text`: Plain text email content
- `html`: HTML email content (optional)
- `template`: Template name (optional)
- `context`: Template context variables (optional)

#### `sendPasswordResetEmail(email, resetToken, resetUrl)`
Send a password reset email with:
- `email`: User's email address
- `resetToken`: Password reset token
- `resetUrl`: Password reset URL with token

## API Integration

The email service is integrated with the application through the following API endpoints:

### Password Reset Flow

1. **Request Password Reset**
   - Endpoint: `POST /api/auth/forgot-password`
   - Request Body: `{ "email": "user@example.com" }`
   - Action: Generates a reset token and sends a password reset email

2. **Verify Reset Token**
   - Endpoint: `POST /api/auth/verify-reset-token`
   - Request Body: `{ "token": "resetTokenValue" }`
   - Action: Validates if the token is valid and not expired

3. **Reset Password**
   - Endpoint: `POST /api/auth/reset-password`
   - Request Body: `{ "token": "resetTokenValue", "newPassword": "newUserPassword" }`
   - Action: Updates the user's password if the token is valid

## Email Templates

### Password Reset Template

The password reset email template (`password-reset.html`) includes:
- Reset password button/link
- Direct URL for manual copying
- Reset token for manual entry
- Styling for better user experience
- Responsive design for mobile devices

## Deployment Considerations

### Production Setup

For production deployment:

1. Configure a real SMTP server in the production configuration
2. Set environment variables for SMTP credentials:
   - `EMAIL_USER`: SMTP server username
   - `EMAIL_PASSWORD`: SMTP server password
3. Set `NODE_ENV=production` to use the production configuration

### Security Considerations

1. Email credentials should be stored securely using environment variables
2. SMTP connections should use TLS/SSL in production
3. Password reset tokens should expire after a reasonable time (e.g., 24 hours)
4. Email templates should not contain sensitive information
5. Rate limiting should be implemented to prevent abuse of email services

### Security Implementations

The following security measures have been implemented to protect the email service:

#### Email Service Security

1. **Input Validation**: 
   - All email addresses are validated using regex pattern checking
   - Template names are checked for path traversal attempts
   - Email subjects are sanitized to prevent header injection

2. **Template Security**:
   - All template variables are HTML-escaped to prevent XSS attacks
   - Template loading uses absolute paths to prevent directory traversal

3. **Transport Security**:
   - Production configuration enforces TLS v1.2 minimum
   - Certificate validation is enabled by default
   - Connection pooling with limits to prevent resource exhaustion

4. **Configuration Security**:
   - No hardcoded credentials - environment variables are required in production
   - Configuration validation at startup
   - Strict format checking for sender email address

#### API Endpoint Security

1. **Rate Limiting**:
   - IP-based rate limiting for password reset requests (5 per hour)
   - Email-based rate limiting (3 requests per email per day)
   - Token verification limits (10 attempts per hour)
   - Password reset endpoint limits (3 attempts per hour)

2. **Token Security**:
   - Tokens generated using cryptographically secure random values
   - Short expiration time (1 hour)
   - Attempt counting to prevent brute force attacks
   - Single-use tokens that expire after use

3. **Information Leakage Prevention**:
   - Consistent response messages regardless of email existence
   - Generic error messages that don't reveal system details
   - Token invalidation after too many verification attempts

4. **Server Hardening**:
   - Security headers (X-Frame-Options, X-Content-Type-Options, X-XSS-Protection)
   - JSON request size limiting
   - Regular cleanup of expired tokens

### Environment Variables

For production deployment, the following environment variables must be set:

| Variable | Description | Example |
|----------|-------------|---------|
| NODE_ENV | Environment setting | "production" |
| EMAIL_HOST | SMTP server hostname | "smtp.gmail.com" |
| EMAIL_PORT | SMTP server port | "587" |
| EMAIL_SECURE | Use TLS (true for port 465) | "false" |
| EMAIL_USER | SMTP username/account | "app@yourdomain.com" |
| EMAIL_PASSWORD | SMTP password | "your-app-password" |
| EMAIL_FROM | Sender email address | '"Your App" <noreply@yourdomain.com>' |

### Security Testing

Before deployment to production, perform the following security tests:

1. **Penetration Testing**:
   - Attempt email header injection with malformed inputs
   - Test rate limiting by exceeding thresholds
   - Try common template injection patterns

2. **Monitoring**:
   - Implement logging of all email sending attempts
   - Set up alerts for unusual email activity
   - Monitor for authentication failures

3. **Regular Auditing**:
   - Review logs weekly for suspicious patterns
   - Test token expiration and cleanup mechanisms
   - Verify that rate limits are working properly

## Maintenance

Regular maintenance tasks for the email service include:

1. **Monitoring**: Set up monitoring for email sending success/failure rates
2. **Updates**: Regularly update Nodemailer and MailDev to latest secure versions
3. **Testing**: Periodically test email delivery and formatting on various email clients
4. **Template Updates**: Review and update email templates as application branding or features change 