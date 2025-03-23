# Email Configuration Guide

This guide explains how to configure the email service in the Angular Template Application to work with various third-party email providers for production use.

## Overview

While the application includes a local email server (MailDev) for development, you must configure a production-grade email service for real-world deployments. This guide covers the configuration process for several popular email service providers.

## Email Verification System

The application includes an email verification system for new user registrations. This section explains how to configure and customize this system.

### How Email Verification Works

1. When a user registers, their account is created with `emailVerified` set to `false`
2. A verification token is generated and stored
3. An email with a verification link is sent to the user's email address
4. The user clicks the link, which contains the verification token
5. The system verifies the token and sets `emailVerified` to `true`
6. The user can now log in to their account

### Configuration Options

The email verification system can be configured with the following environment variables:

| Variable | Description | Default Value | Example |
|----------|-------------|---------------|---------|
| EMAIL_VERIFICATION_REQUIRED | Whether email verification is required | "true" | "true" |
| EMAIL_VERIFICATION_TOKEN_EXPIRY | Token expiration time in milliseconds | "86400000" (24 hours) | "43200000" (12 hours) |
| EMAIL_VERIFICATION_BASE_URL | Base URL for verification links | "http://localhost:4200/verify-email" | "https://yourdomain.com/verify-email" |

### Verification Email Template

The verification email template can be customized by editing the file at:
```
angular/frontend/server/email-service/templates/verification-email.html
```

The template uses the following variables:
- `{{userName}}`: The user's name or email if name is not provided
- `{{verificationLink}}`: The full verification link with token
- `{{expiryHours}}`: The token expiration time in hours

### Verification URL Structure

The verification URLs are structured as follows:
```
{EMAIL_VERIFICATION_BASE_URL}?token={verification_token}&email={user_email}
```

For local development, this would typically be:
```
http://localhost:4200/verify-email?token=abc123def456&email=user@example.com
```

For production, ensure the base URL is updated to your domain:
```
https://your-production-domain.com/verify-email?token=abc123def456&email=user@example.com
```

### Testing Verification

To test the email verification system locally:

1. Start the MailDev server
2. Register a new user through the application
3. Check MailDev for the verification email
4. Click the verification link or copy it to your browser
5. Verify the account is successfully verified

## Running Locally

The Angular Template Application includes MailDev for local development and testing of email functionality.

### Setting Up MailDev

MailDev is a simple SMTP server with a web interface designed for development environments. To use it locally:

1. Navigate to the email service directory:
   ```bash
   cd angular/frontend/server/email-service
   ```

2. Start the MailDev server:
   ```bash
   node start-maildev.js
   ```

This will start MailDev with:
- SMTP server on port 1025 (only accessible from localhost)
- Web interface on port 1080 (http://localhost:1080)

### Current Integration

The application is configured to use MailDev automatically when:
- The `NODE_ENV` environment variable is not set to "production"
- No email service environment variables are provided

Configuration for local development is preset in:
```javascript
// angular/frontend/server/email-service/config/email-config.js
const config = {
  development: {
    transport: {
      host: '127.0.0.1',
      port: 1025,
      ignoreTLS: true
    }
  }
  // ...
};
```

### Local Testing

To test email functionality locally:
1. Start the MailDev server as described above
2. Run your application in development mode
3. Trigger an email-sending action in your application
4. View the caught email in the MailDev web interface (http://localhost:1080)

### Production Considerations

While MailDev is convenient for development, there are important considerations regarding its use in production:

- **Security considerations**: MailDev lacks authentication mechanisms and other security features needed for production environments. For more details, see the [MailDev Security section](./security.md#maildev-security) in our security guide.

- **Email deliverability**: MailDev doesn't actually deliver emails to recipients' inboxes and lacks features like SPF, DKIM, and DMARC support that are essential for proper email delivery.

For production deployments, we recommend using one of the supported third-party email services described in the sections below.

## General Configuration

Regardless of which email provider you choose, you'll need to configure these environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| EMAIL_HOST | SMTP server hostname | "smtp.gmail.com" |
| EMAIL_PORT | SMTP server port | "587" |
| EMAIL_SECURE | Use TLS (true for port 465) | "false" |
| EMAIL_USER | SMTP username/account | "app@yourdomain.com" |
| EMAIL_PASSWORD | SMTP password or app password | "your-app-password" |
| EMAIL_FROM | Sender email address | '"Your App" <noreply@yourdomain.com>' |

## Configuration Methods

There are several ways to configure the email service:

### 1. Environment Variables

Set environment variables before starting the application:

```bash
# Windows PowerShell
$env:NODE_ENV = "production"
$env:EMAIL_HOST = "smtp.gmail.com"
$env:EMAIL_PORT = "587"
$env:EMAIL_SECURE = "false"
$env:EMAIL_USER = "your-email@gmail.com"
$env:EMAIL_PASSWORD = "your-app-password"
$env:EMAIL_FROM = '"Your App" <your-email@gmail.com>'

# Start the application
npm run serve:ssr:frontend
```

```bash
# Linux/macOS
export NODE_ENV=production
export EMAIL_HOST=smtp.gmail.com
export EMAIL_PORT=587
export EMAIL_SECURE=false
export EMAIL_USER=your-email@gmail.com
export EMAIL_PASSWORD=your-app-password
export EMAIL_FROM='"Your App" <your-email@gmail.com>'

# Start the application
npm run serve:ssr:frontend
```

### 2. Environment Configuration File

Create a `.env` file in the root of your project (add this file to `.gitignore` to avoid committing credentials):

```
NODE_ENV=production
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM="Your App" <your-email@gmail.com>
```

### 3. Docker Environment Variables

When using Docker, pass environment variables when running the container:

```bash
docker run -d -p 80:4000 \
  -e NODE_ENV=production \
  -e EMAIL_HOST=smtp.gmail.com \
  -e EMAIL_PORT=587 \
  -e EMAIL_SECURE=false \
  -e EMAIL_USER=your-email@gmail.com \
  -e EMAIL_PASSWORD=your-app-password \
  -e EMAIL_FROM='"Your App" <your-email@gmail.com>' \
  --name angular-app \
  angular-template:latest
```

## Provider-Specific Configuration

### Gmail

To use Gmail as your email provider:

1. Enable "Less secure app access" or preferably use an App Password:
   - Go to your Google Account → Security
   - Enable 2-Step Verification if not already enabled
   - Set up an App Password for "Mail" and "Other (Custom name)"
   - Use this App Password in your configuration instead of your regular password

2. Configure the environment variables:
   ```
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_SECURE=false
   EMAIL_USER=your-gmail-address@gmail.com
   EMAIL_PASSWORD=your-app-password
   ```

### Amazon SES

To use Amazon SES (Simple Email Service):

1. Create an AWS account if you don't have one
2. Verify your domain and email addresses in SES
3. Create SMTP credentials in the SES console
4. Configure the environment variables:
   ```
   EMAIL_HOST=email-smtp.us-east-1.amazonaws.com
   EMAIL_PORT=587
   EMAIL_SECURE=false
   EMAIL_USER=YOUR_SES_SMTP_USERNAME
   EMAIL_PASSWORD=YOUR_SES_SMTP_PASSWORD
   ```

Note: Replace the host with the appropriate regional endpoint for your SES configuration.

### SendGrid

To use SendGrid as your email provider:

1. Create a SendGrid account
2. Create an API key with "Mail Send" permissions
3. Configure the environment variables:
   ```
   EMAIL_HOST=smtp.sendgrid.net
   EMAIL_PORT=587
   EMAIL_SECURE=false
   EMAIL_USER=apikey
   EMAIL_PASSWORD=YOUR_SENDGRID_API_KEY
   ```

Note: For SendGrid, the EMAIL_USER is literally "apikey" and the EMAIL_PASSWORD is your actual API key.

### Mailgun

To use Mailgun as your email provider:

1. Create a Mailgun account
2. Set up and verify your domain
3. Get your SMTP credentials from the Domains tab
4. Configure the environment variables:
   ```
   EMAIL_HOST=smtp.mailgun.org
   EMAIL_PORT=587
   EMAIL_SECURE=false
   EMAIL_USER=postmaster@your-domain.com
   EMAIL_PASSWORD=your-mailgun-password
   ```

### Microsoft 365 / Outlook

To use Microsoft 365 or Outlook:

1. If using Microsoft 365, ensure your account allows SMTP authentication
2. For personal Outlook accounts, you may need to create an app password:
   - Go to your Microsoft account security settings
   - Set up two-step verification if not already enabled
   - Create an app password and use it instead of your regular password

3. Configure the environment variables:
   ```
   EMAIL_HOST=smtp.office365.com
   EMAIL_PORT=587
   EMAIL_SECURE=false
   EMAIL_USER=your-email@outlook.com
   EMAIL_PASSWORD=your-password-or-app-password
   ```

## Advanced Configuration

For more advanced email configurations, you can modify the `email-config.js` file directly:

```javascript
// Path: angular/frontend/server/email-service/config/email-config.js

const config = {
  production: {
    transport: {
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      },
      // Additional configuration options:
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      // TLS options
      requireTLS: true,
      tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
      }
    },
    // Other options...
  }
};
```

### Additional Options

The email service configuration supports these additional options:

- **pool**: Boolean to use connection pooling (improves performance for multiple emails)
- **maxConnections**: Maximum number of simultaneous connections (for pooling)
- **maxMessages**: Maximum number of messages per connection (for pooling)
- **requireTLS**: Require TLS for security
- **tls.minVersion**: Minimum TLS version for secure connections
- **debug**: Enable verbose logging for troubleshooting

## Testing Email Configuration

After configuring your email service, test it to ensure emails are being sent correctly:

```bash
# Set the NODE_ENV to production
$env:NODE_ENV = "production"  # Windows PowerShell
# export NODE_ENV=production  # Linux/macOS

# Run the email security tests
npm run security-test
```

If the tests pass, your email configuration is working correctly.

## Troubleshooting

### Common Issues

1. **Authentication Failure**:
   - Verify your credentials are correct
   - Check if you need to use an app password
   - Ensure your account allows SMTP access

2. **Connection Timeout**:
   - Check if the email server is accessible from your deployment
   - Verify firewall rules allow outbound SMTP connections
   - Try a different port (587 or 465)

3. **TLS Errors**:
   - Ensure your NODE_ENV is set to "production"
   - Verify the correct port and TLS settings
   - Check if your email provider requires specific TLS settings

4. **Rate Limiting**:
   - Many providers have sending limits, check your provider's documentation
   - Implement a queuing system for high-volume email sending

### Debugging

To enable detailed logging for troubleshooting email issues:

```bash
# Enable debug logging
$env:DEBUG = "true"
$env:DEBUG_LOG_FILE = "true"

# Run the application or tests
npm run serve:ssr:frontend
```

Check the logs in the `angular/frontend/server/email-service/logs` directory for detailed information about email operations.

## Production Best Practices

1. **Use Dedicated Sending Domains**: 
   - Set up a subdomain (e.g., `mail.yourdomain.com`) for sending emails
   - Helps protect your main domain reputation

2. **Configure SPF, DKIM, and DMARC Records**:
   - Improves deliverability and prevents spoofing
   - Follow your email provider's documentation to set up these DNS records

3. **Implement Email Templates**:
   - Create professional, responsive email templates
   - Test templates in various email clients

4. **Monitor Delivery Metrics**:
   - Track open rates, bounce rates, and delivery success
   - Most email providers offer analytics dashboards

5. **Implement Bounce Handling**:
   - Process bounce notifications to clean your recipient lists
   - Remove invalid emails to maintain good sender reputation

## Conclusion

By configuring a production-grade email service, you ensure reliable email delivery for critical application functions like password resets and notifications. Choose the email provider that best fits your needs and budget, and always follow security best practices when storing and using email credentials. 