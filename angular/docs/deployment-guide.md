# Deployment Guide for Angular Template Application

This guide provides step-by-step instructions for deploying the Angular Template Application to a production environment.

## Prerequisites

Before deploying, ensure you have:

- Node.js (v14 or later) and npm installed on your deployment environment
- Access to the production server or hosting platform
- Required environment variables or configuration files
- A production-ready email service (not MailDev) - see [Email Configuration Guide](./email-configuration-guide.md)
- Proper database credentials for your production database

## Pre-Deployment Checklist

- [ ] All automated tests pass
- [ ] Security checks pass
- [ ] Environment variables are configured
- [ ] Database migrations are prepared (if applicable)
- [ ] Static assets are optimized
- [ ] Application branding is configured (name, logos, colors)
- [ ] Theme configuration matches organization guidelines
- [ ] Logo assets are properly sized and optimized for web
- [ ] Email service is configured for production
- [ ] Any API keys have been updated for production services

## Building for Production

1. Navigate to the frontend directory:
   ```bash
   cd angular/frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the application for production:
   ```bash
   npm run build:prod
   ```
   
   This command creates a production build with optimized assets in the `dist/frontend` directory.

## Running Automated Tests

To run all tests and ensure the application is ready for deployment:

1. Navigate to the frontend directory:
   ```bash
   cd angular/frontend
   ```

2. Run the global test script:
   ```bash
   npm run test:all
   ```

This will execute all tests, including:
- Unit tests
- Integration tests
- End-to-end tests

### Analyzing Test Results

Test results will be displayed in the console and also saved to log files in the `angular/frontend/test-results` directory. Check for:

- **Failed tests**: Any test failures must be resolved before deployment
- **Code coverage**: Ensure adequate test coverage (typically aim for >80%)
- **Performance issues**: Address any performance bottlenecks identified in tests

## Security Verification

Run a comprehensive security audit before deployment:

1. Navigate to the frontend directory:
   ```bash
   cd angular/frontend
   ```

2. Run the security audit:
   ```bash
   npm run security:audit
   ```

3. Specifically for email service security, run:
   ```bash
   cd server/email-service
   npm run security-test
   ```

### Security Checklist

Ensure the following security measures are in place:

- [ ] Dependencies are up-to-date and free of vulnerabilities
- [ ] Proper CSP (Content Security Policy) headers are configured
- [ ] HTTPS is enforced
- [ ] Authentication mechanisms are robust
- [ ] Input validation is thorough
- [ ] Email templates are sanitized against injection attacks
- [ ] API endpoints implement rate limiting
- [ ] Sensitive data is properly encrypted

## Email Verification Configuration

The application includes an email verification system for new user registrations. This must be properly configured for production:

### Email Verification Requirements

1. Configure the proper base URL for email verification links:
   ```
   EMAIL_VERIFICATION_BASE_URL=https://your-production-domain.com/verify-email
   ```

2. Set appropriate token expiration times:
   ```
   EMAIL_VERIFICATION_TOKEN_EXPIRY=86400000  # 24 hours in milliseconds
   ```

3. Ensure the email service is properly configured to send verification emails
   (See [Email Configuration Guide](./email-configuration-guide.md) for details)

### Security Considerations for Email Verification

- Use HTTPS for all verification links in production
- Implement rate limiting for verification attempts
- Do not include sensitive information in verification emails
- Implement monitoring for unusual verification patterns

For detailed implementation information, refer to the [Email Configuration Guide](./email-configuration-guide.md).

## GDPR Compliance Considerations

The application implements basic GDPR compliance features. For production deployment, consider:

### Data Protection Requirements

1. Ensure user data is stored securely and encrypted
2. Configure appropriate data retention policies
3. Implement proper access controls for personal data
4. Document all data processing activities

### Account Deletion Features

The application includes a user account deletion feature that removes personal identifiable information (PII). When deploying:

1. Ensure the account deletion mechanism is properly tested
2. Configure a proper process for handling data deletion requests
3. Consider implementing a mechanism for data export (future enhancement)
4. Document what data is removed and what is retained upon deletion

For more information, see the [GDPR Compliance Documentation](./gdpr-compliance.md).

## Email Service Configuration

**Warning**: The local email server (MailDev) included in this template is for development purposes only. It should **not** be used in production environments for the following reasons:

- It does not implement proper email delivery protocols
- It lacks security features necessary for production use
- It does not handle email delivery verification
- It cannot ensure deliverability or proper inbox placement

For production deployment, configure a proper email service as detailed in the [Email Configuration Guide](./email-configuration-guide.md).

## Theme and Branding Configuration

The application's visual appearance, including themes, logos, and branding elements, can be customized for your organization:

### Branding Requirements

1. **Application Configuration**: The [`app-config.ts`](../frontend/src/environments/app-config.ts) file contains settings for the application name and logo paths which can be customized to match your organization's branding.

2. **Logo Assets**: Place your custom logo files in the `assets/logos/` directory to replace the default branding elements. Refer to the [Theme Configuration Guide](./theme-configuration-guide.md) for recommended logo specifications.

3. **Theme Colors**: The [`styles.scss`](../frontend/src/styles.scss) file contains theme imports and CSS variables that can be modified to match your brand's color scheme and visual identity.

For detailed instructions on customizing themes, stylesheets, and branding elements, refer to the [Theme Configuration Guide](./theme-configuration-guide.md).

## Environment Configuration

Create or update the production environment file with the following variables:

```
NODE_ENV=production
API_URL=https://your-api-url.com
EMAIL_HOST=your-email-host.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email-user
EMAIL_PASSWORD=your-email-password
EMAIL_FROM=your-email-from-address
DATABASE_URL=your-database-url
EMAIL_VERIFICATION_BASE_URL=https://your-production-domain.com/verify-email
EMAIL_VERIFICATION_TOKEN_EXPIRY=86400000
```

## Deployment to Server

### Traditional Server Deployment

1. Transfer the built application to your server:
   ```bash
   scp -r dist/frontend user@your-server:/path/to/deployment
   ```

2. Install production dependencies:
   ```bash
   cd /path/to/deployment
   npm ci --only=production
   ```

3. Start the server:
   ```bash
   # Using a process manager like PM2 is recommended
   pm2 start server.js --name "angular-template"
   ```

### Docker Deployment

1. Build the Docker image:
   ```bash
   docker build -t angular-template:latest .
   ```

2. Run the container:
   ```bash
   docker run -d -p 80:4000 \
     -e NODE_ENV=production \
     -e API_URL=https://your-api-url.com \
     # Add other environment variables here \
     --name angular-app \
     angular-template:latest
   ```

## Post-Deployment Verification

After deployment, perform these checks:

1. Verify the application loads correctly in the browser
2. Test all critical user flows (login, signup, etc.)
3. Ensure all API endpoints respond correctly
4. Confirm emails are sent properly
5. Check for any console errors
6. Verify analytics tracking is working (if applicable)
7. Test on multiple browsers and devices
8. Verify email verification process works end-to-end
9. Test the account deletion process (GDPR compliance)

## Monitoring and Maintenance

Set up monitoring for your deployed application:

- Configure application logging to a centralized service
- Set up uptime monitoring
- Configure error tracking (e.g., Sentry)
- Set up performance monitoring
- Configure alerts for critical issues

## Troubleshooting Common Issues

### Application Not Loading

- Check server logs for errors
- Verify that the server is running
- Ensure ports are correctly configured
- Check for network connectivity issues

### Email Service Issues

- Verify email configuration variables
- Check firewall settings for outgoing SMTP connections
- Ensure your email provider allows sending from your server's IP
- Enable debug logging for the email service:
  ```
  DEBUG=true DEBUG_LOG_FILE=true
  ```

### Database Connection Issues

- Verify database connection string
- Check database server status
- Ensure firewall rules allow connections
- Verify credentials are correct

## Regular Maintenance Tasks

- Update dependencies regularly to patch security vulnerabilities
- Rotate credentials periodically
- Monitor disk space and server resources
- Backup database and configuration regularly
- Review and update security measures

## Rollback Plan

In case of critical issues after deployment:

1. Revert to the previous stable version:
   ```bash
   # If using Git tags for releases
   git checkout v1.0.0
   npm install
   npm run build:prod
   # Then redeploy
   ```

2. Or restore from backup if available

3. Notify users of temporary disruption if necessary

## Additional Resources

- [Angular Deployment Guide](https://angular.io/guide/deployment)
- [Email Configuration Guide](./email-configuration-guide.md)
- [GDPR Compliance Documentation](./gdpr-compliance.md)
- [Security Best Practices](https://angular.io/guide/security)
- [Performance Optimization Guide](https://web.dev/angular) 