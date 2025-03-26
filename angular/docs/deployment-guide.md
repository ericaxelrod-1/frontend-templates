# Deployment Guide for Angular Template Application

This guide provides step-by-step instructions for deploying the Angular Template Application to a production environment.

## Prerequisites

Before deploying, ensure you have:

- Node.js (v14 or later) and npm installed on your deployment environment
- Access to the production server or hosting platform
- Required environment variables or configuration files
- A production-ready email service (not MailDev) - see [Email Configuration Guide](./email-configuration-guide.md)
- Proper database credentials for your production database

## Development Setup

### 1. Installing Dependencies

From the project root, install dependencies for both frontend and backend:

```bash
# Frontend dependencies
cd angular/frontend
npm install

# Backend dependencies
cd angular/backend
npm install
```

### 2. Starting Development Servers

Both servers need to be running simultaneously in separate terminal windows:

#### Frontend Development Modes

1. **Standard Development Mode**
```bash
cd angular/frontend
npm start
# or
ng serve
```
- Use for: Regular development work
- Features:
  - Live reload on file changes
  - Basic error reporting
  - Default development configuration

2. **Debug Mode**
```bash
cd angular/frontend
npm start -- --configuration=development
# or
ng serve --configuration=development
```
- Use for: Debugging application issues
- Features:
  - More detailed console output
  - Source maps for browser dev tools
  - Angular's debug tools for component inspection
  - Enhanced error reporting

3. **Verbose Mode**
```bash
cd angular/frontend
npm start -- --verbose
# or
ng serve --verbose
```
- Use for: Build troubleshooting
- Features:
  - Full compilation process logs
  - Webpack configuration details
  - Build performance analysis

4. **Production Simulation Mode**
```bash
cd angular/frontend
npm start -- --configuration=production
# or
ng serve --configuration=production
```
- Use for: Testing production behavior
- Features:
  - Production optimization (bundling, minification)
  - Disabled debug tools
  - Disabled verbose logging
  - Performance testing environment

5. **Hot Module Replacement (HMR) Mode**
```bash
cd angular/frontend
npm start -- --hmr
# or
ng serve --hmr
```
- Use for: Rapid UI development
- Features:
  - Updates modules without page refresh
  - Preserves application state
  - Faster development workflow

6. **Combined Options**
```bash
cd angular/frontend
ng serve --configuration=development --verbose --hmr
```
- Use for: Advanced development needs
- Combines multiple features for specific use cases

#### Backend Development Modes

1. **Standard Development Mode**
```bash
cd angular/backend
npm run start:dev
```
- Use for: Regular backend development
- Features:
  - Basic development configuration
  - Standard logging

2. **Debug Mode**
```bash
cd angular/backend
npm run start:dev -- --debug
```
- Use for: Backend troubleshooting
- Features:
  - Detailed logging enabled
  - Enhanced error information
  - Debug-level messages

3. **Watch Mode**
```bash
cd angular/backend
npm run start:debug
```
- Use for: Active backend development
- Features:
  - Automatic restart on file changes
  - Enhanced debugging capabilities
  - Ideal for rapid development

### 3. Configuration Modes

The `--configuration` flag in Angular determines which environment settings to use:

1. **Development Configuration** (`--configuration=development`)
- Environment: development
- Debugging: enabled
- Optimization: disabled
- Source maps: enabled
- Use when: Developing and debugging

2. **Production Configuration** (`--configuration=production`)
- Environment: production
- Debugging: disabled
- Optimization: enabled
- Source maps: disabled
- Use when: Testing production builds

### 4. Access Points

- Frontend: http://localhost:4200
- Backend: http://localhost:3000
- API Documentation: http://localhost:3000/api

### 5. Additional Development Features

- Interactive API documentation available at http://localhost:3000/api
- SQLite database used by default (file: `angular/backend/db.sqlite`)
- Comprehensive logging in debug mode
- Frontend options can be combined for specific needs

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
- [ ] Cookie consent configuration is appropriate for target regions

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
- [ ] Cookie consent is configured properly for compliance

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

## Cookie Consent Configuration

The application includes a comprehensive cookie consent system that complies with GDPR, CCPA, and other privacy regulations. For production deployment, ensure proper configuration:

### Cookie Consent Requirements

1. Enable the cookie consent system in your production environment:
   ```
   ENABLE_COOKIE_CONSENT=true
   ```

2. Configure default cookie settings based on your application needs:
   ```
   COOKIE_NECESSARY_ENABLED=true        # Always true, required cookies
   COOKIE_PREFERENCES_DEFAULT=false     # Default OFF for conservative compliance
   COOKIE_ANALYTICS_DEFAULT=false       # Default OFF for conservative compliance
   COOKIE_MARKETING_DEFAULT=false       # Default OFF for conservative compliance
   ```

3. Set up appropriate tracking IDs for production:
   ```
   ANALYTICS_TRACKING_ID=G-XXXXXXXXXX   # Your Google Analytics ID
   MARKETING_PIXEL_ID=XXXXXXXXXXXXX     # Your Facebook Pixel ID (if used)
   ```

### Database Integration

The cookie consent system optionally integrates with user accounts. To enable this feature:

1. Enable user account storage in environment settings:
   ```
   STORE_COOKIE_CONSENT_WITH_USER=true
   ```

2. Ensure your API has the `/api/user/cookie-consent` endpoint properly configured

3. Test the consent storage flow before deployment

### Legal Compliance Considerations

- Include links to your Privacy Policy and Terms of Service
- Update the cookie banner text to accurately reflect your cookie usage
- Adapt the cookie categories based on what your site actually uses
- Test the consent mechanism thoroughly before deployment

For detailed implementation and customization information, refer to the [Cookie Management Guide](./cookies.md).

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
ENABLE_COOKIE_CONSENT=true
COOKIE_NECESSARY_ENABLED=true
COOKIE_PREFERENCES_DEFAULT=false
COOKIE_ANALYTICS_DEFAULT=false
COOKIE_MARKETING_DEFAULT=false
```

## Environment Configuration Files

The application uses different environment files for various stages of development and deployment. Below is a breakdown of each file and its purpose:

### 1. `.env` (Default/Production Environment)
- **Location**: `angular/backend/.env`
- **Purpose**: Default configuration used in production environments
- **Usage**: 
  - Used when running in production mode: `npm run start:prod`
  - Contains production database settings, security keys, etc.
- **Key Settings**:
  - `DATABASE_FILE`: Path to database file
  - `DATABASE_SYNCHRONIZE`: Should be `false` for production
  - `JWT_SECRET`: Secure secret key for JWT tokens
  - `PORT`: API server port (default: 3000)

### 2. `.env.development` (Development Environment)
- **Location**: `angular/backend/.env.development`
- **Purpose**: Configuration specific to development environments
- **Usage**:
  - Used when running: `npm run start:dev`
  - Used when running: `npm run start:debug`
- **Key Settings**:
  - `DATABASE_WRITE_ENABLED`: Set to `true` to enable database writes during development
  - `DATABASE_SYNCHRONIZE`: Set to `true` for automatic schema updates
  - `DEBUG`: Set to `true` for enhanced logging
  - `THROTTLE_LIMIT`: Higher value for easier development

### 3. `.env.test` (Testing Environment)
- **Location**: `angular/backend/.env.test`
- **Purpose**: Configuration specific to automated tests
- **Usage**:
  - Used when running: `npm run test`
  - Used when running: `npm run test:e2e`
- **Key Settings**:
  - `DATABASE_NAME`: Set to `:memory:` for in-memory testing database
  - `PORT`: Different from development (3001) to avoid conflicts
  - `DATABASE_SYNCHRONIZE`: Set to `true` for clean test environment

### Environment Variables Reference

Below is a complete reference of all environment variables used in the application:

| Variable | Description | Default | Used In |
|----------|-------------|---------|---------|
| `NODE_ENV` | Environment mode | `development` | All modes |
| `PORT` | API server port | `3000` | All modes |
| `DATABASE_FILE` | SQLite database file path | `db.sqlite` | Development/Production |
| `DATABASE_SYNCHRONIZE` | Auto-update database schema | `false` | All modes |
| `DATABASE_WRITE_ENABLED` | Enable database writes | `true` in dev, `true` in prod | Development |
| `MIGRATIONS_RUN` | Run migrations on startup | `true` | Development/Production |
| `JWT_SECRET` | Secret for JWT signing | varies by environment | All modes |
| `JWT_EXPIRES_IN` | JWT expiration time | `1d` | All modes |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token expiration | `7d` | Development/Production |
| `FRONTEND_URL` | URL of the frontend application | `http://localhost:4200` | All modes |
| `THROTTLE_TTL` | Rate limiting time window (seconds) | `60` | All modes |
| `THROTTLE_LIMIT` | Maximum requests per time window | `10` in prod, `100` in dev | All modes |
| `DEBUG` | Enable debug mode | `true` in dev, `false` in prod | Development |
| `DEBUG_LOG_LEVEL` | Logging verbosity | `debug` | Development |
| `ENABLE_COOKIE_CONSENT` | Enable cookie consent system | `true` | All modes |
| `COOKIE_NECESSARY_ENABLED` | Enable necessary cookies | `true` | All modes |
| `COOKIE_PREFERENCES_DEFAULT` | Default for preference cookies | `false` | All modes |
| `COOKIE_ANALYTICS_DEFAULT` | Default for analytics cookies | `false` | All modes |
| `COOKIE_MARKETING_DEFAULT` | Default for marketing cookies | `false` | All modes |
| `ANALYTICS_TRACKING_ID` | Google Analytics ID | - | Production |
| `MARKETING_PIXEL_ID` | Facebook Pixel ID | - | Production |
| `STORE_COOKIE_CONSENT_WITH_USER` | Store consent with user accounts | `true` | All modes |

### Overriding Environment Variables

You can override any environment variable by:

1. Setting it directly when running a command:
   ```bash
   DATABASE_WRITE_ENABLED=true npm run start:dev
   ```

2. Creating a custom `.env.local` file (not tracked by Git) with your personal overrides

### Database Writes in Development Mode

By default, the application now includes the `DATABASE_WRITE_ENABLED=true` setting in the development environment file. This enables database writes during development, allowing you to:

- Create and register user accounts
- Test the full email verification flow
- Add and modify data in development
- Test role assignments and group memberships

If you need to work without persisting data, you can override this setting:
```bash
DATABASE_WRITE_ENABLED=false npm run start:dev
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
     -e ENABLE_COOKIE_CONSENT=true \
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
10. Verify the cookie consent banner appears and functions correctly

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

### Cookie Consent Issues

- Check browser console for JavaScript errors
- Verify that cookie consent preferences are saved in localStorage
- Test cookie storage with different settings combinations
- Ensure tracking scripts respect consent settings

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
- Update privacy policies when cookie behavior changes

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
- [Cookie Management Guide](./cookies.md)
- [GDPR Compliance Documentation](./gdpr-compliance.md)
- [Security Best Practices](https://angular.io/guide/security)
- [Performance Optimization Guide](https://web.dev/angular)

### Environment Files vs. CLI Flags

It's important to understand the difference between environment files and CLI flags:

#### Environment Files (`.env`, `.env.development`, `.env.test`)
- Control application behavior and runtime configuration
- Define variables like database connections, API URLs, feature flags
- Loaded by the server process during startup
- Accessed through `process.env` in the backend code

#### Angular CLI Flags (--verbose, --hmr, --configuration)
- Control how the Angular CLI builds and serves the application
- Do not directly interact with environment files
- Applied during the build/serve process
- Examples:
  - `--verbose`: Increases build process logging, showing detailed webpack output
  - `--hmr`: Enables Hot Module Replacement for faster frontend development
  - `--configuration`: Selects which Angular environment file to use (not related to backend `.env` files)

#### Using Both Together

When developing, you often use both systems in tandem:

```bash
# Start backend with environment file
cd angular/backend
npm run start:dev  # Uses .env.development

# In another terminal, start frontend with CLI flags
cd angular/frontend
ng serve --verbose --hmr  # Uses Angular CLI flags
```

This combination gives you detailed build logs and fast frontend updates while also enabling the proper backend configuration for development. 