# Email Service for Angular Application

This folder contains the email service implementation for the Angular application, focusing on sending transactional emails like password reset notifications.

## Features

- Nodemailer integration for sending emails
- MailDev for local development and testing
- HTML email templates
- Environment-based configuration (development/production)
- Password reset email functionality

## Getting Started

### Prerequisites

- Node.js 16+
- npm or yarn

### Starting the Service

To start the MailDev server for local email testing:

```bash
npm run start:maildev
```

To run both the MailDev server and the Angular application:

```bash
npm run start:email-dev
```

### Testing the Email Service

1. Access the Angular application at http://localhost:4200
2. Navigate to the "Forgot Password" page
3. Enter an email address and submit the form
4. Check the MailDev web interface at http://localhost:1080 to view the sent email

## Configuration

The email service configuration is in `config/email-config.js`. The service supports two environments:

### Development
- Uses MailDev as local SMTP server (localhost:1025)
- No authentication required
- Web interface at localhost:1080

### Production
- Configurable SMTP server settings
- Authentication via environment variables
- Secure connection options

## Structure

- `config/` - Configuration files
- `templates/` - HTML email templates
- `email-service.js` - Main service implementation
- `start-maildev.js` - Script to start MailDev server

## API

The email service exposes the following methods:

### sendEmail(options)
Send a generic email with options:
- `to`: Recipient email
- `subject`: Email subject
- `text`: Plain text content
- `html`: HTML content (optional)
- `template`: Template name (optional)
- `context`: Template variables (optional)

### sendPasswordResetEmail(email, resetToken, resetUrl)
Send a password reset email with:
- `email`: User's email
- `resetToken`: Reset token
- `resetUrl`: Reset page URL

## Further Documentation

For more detailed information, see the [Email Service Documentation](../docs/email-service.md) in the project docs folder. 