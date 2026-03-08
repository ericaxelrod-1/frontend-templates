# Deployment Guide for Angular Template Application

This guide provides step-by-step instructions for deploying the Angular Template Application to a production environment.

## Prerequisites

Before deploying, ensure you have:

- Node.js (v14 or later) and npm installed on your deployment environment
- Access to the production server or hosting platform
- Required environment variables or configuration files
- A production-ready email service (not MailDev) - see [Email Configuration Guide](./email-configuration-guide.md)
- Proper database credentials for your production database

## Default Credentials

After initial setup, the following default user accounts are created:

### Super Admin Account
- **Email**: admin@example.com
- **Password**: Admin123!
- **Role**: SUPERADMIN
- **Important**: For security reasons, you will be required to change this password on first login

### Additional Default Accounts
- Manager Account:
  - Email: manager@example.com
  - Password: Manager123!
  - Role: SUPERUSER

- Regular User Account:
  - Email: user@example.com
  - Password: User123!
  - Role: USER

⚠️ **Security Warning**: Change all default passwords immediately after deployment. These credentials are for initial setup only and should not be used in a production environment.

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
- Replace the sample placeholder Privacy Policy (src/app/features/legal/privacy-policy) with a legally valid policy for your production deployment
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
  - `