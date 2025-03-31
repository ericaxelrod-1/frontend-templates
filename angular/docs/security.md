# Security Guide

This guide provides security recommendations and information about security measures implemented in the Angular Template Application.

## General Security Measures

The Angular Template Application implements various security measures to protect user data and prevent common vulnerabilities:

### Authentication and Authorization

- **JWT-based Authentication**: Secure token-based authentication with appropriate expiration
- **Role-based Access Control**: Granular permissions for different user roles
- **Route Guards**: Angular route guards preventing unauthorized access to protected routes
- **HTTP Interceptors**: Automatically attach authentication tokens to requests

### Input Validation and Sanitization

- **Form Validation**: Client-side validation using Angular Reactive Forms
- **API Validation**: Server-side validation for all inputs
- **HTML Sanitization**: Protection against XSS attacks using Angular's built-in sanitization
- **Content Security Policy**: CSP headers to prevent injection attacks

### Other Security Features

- **HTTPS Enforcement**: Redirection from HTTP to HTTPS
- **CSRF Protection**: Cross-Site Request Forgery tokens for sensitive operations
- **Rate Limiting**: Prevention of brute force attacks on authentication endpoints
- **Secure Password Storage**: Passwords stored using strong one-way hashing with salts
- **Input Sanitization**: Protection against SQL injection and NoSQL injection attacks

## Security Recommendations for Production Deployments

### Infrastructure Security

#### AWS Deployment Recommendations

- **Network Configuration**:
  - Use VPC with private subnets for application servers
  - Expose only necessary ports through security groups
  - Implement Web Application Firewall (WAF) with AWS CloudFront
  - Use AWS Shield for DDoS protection

- **Service Configuration**:
  - Deploy to Elastic Beanstalk or ECS for managed environments
  - Use AWS Secrets Manager for sensitive credentials
  - Enable CloudTrail for API activity logging
  - Implement AWS Config for configuration compliance

#### Azure Deployment Recommendations

- **Network Configuration**:
  - Use Virtual Networks with Network Security Groups
  - Implement Azure Application Gateway with WAF
  - Use Azure DDoS Protection
  - Configure Private Link for secure service connections

- **Service Configuration**:
  - Deploy to App Service with proper authentication
  - Use Azure Key Vault for secrets management
  - Enable Azure Security Center
  - Implement Azure Monitor for security logging

#### GCP Deployment Recommendations

- **Network Configuration**:
  - Use VPC with appropriate firewall rules
  - Implement Cloud Armor for WAF functionality
  - Use Cloud Load Balancing with proper security settings
  - Enable Cloud IAP for accessing admin interfaces

- **Service Configuration**:
  - Deploy to App Engine or GKE with secure configurations
  - Use Secret Manager for sensitive data
  - Enable Cloud Security Command Center
  - Implement Cloud Logging for security events

### General Infrastructure Recommendations

Regardless of cloud provider, consider these security measures:

- **Port Restrictions**:
  - Block all ports except 80 (HTTP) and 443 (HTTPS) at the edge
  - For the application servers, only allow traffic from load balancers
  - For databases, only allow connections from application servers

- **Firewall Configuration**:
  - Implement both network and application-level firewalls
  - Enable geo-blocking for regions where your application doesn't operate
  - Set up rate limiting rules to prevent DoS attacks

- **TLS Configuration**:
  - Use minimum TLS 1.2, preferably TLS 1.3
  - Configure strong cipher suites
  - Implement HSTS headers
  - Regularly rotate SSL certificates

- **Monitoring and Logging**:
  - Implement centralized logging
  - Set up alerts for suspicious activities
  - Perform regular security audits
  - Use intrusion detection/prevention systems

## Module-Specific Security Measures

### MailDev Security {#maildev-security}

The local email server (MailDev) included in this application is configured with the following security measures:

1. **Localhost Binding**:
   - The SMTP server (port 1025) is bound only to 127.0.0.1
   - The web interface (port 1080) is also bound only to localhost
   - This prevents external network access to both services

2. **Environment-Based Activation**:
   - MailDev is only used when NODE_ENV is not set to "production"
   - Production configuration requires proper email service credentials

3. **Network Isolation**:
   - Non-standard ports (1025, 1080) are used instead of standard email ports
   - No authentication is enabled because the service is only accessible locally
   - No email relay functionality is configured

4. **Production Safeguards**:
   - The email service configuration automatically switches to production settings when:
     - NODE_ENV is set to "production"
     - Email service environment variables are present

**Production Considerations**:

While MailDev provides a convenient development environment, there are important considerations if deploying in production-like environments:

- **Authentication**: MailDev lacks built-in authentication mechanisms
- **Security Features**: Limited security features compared to production email services
- **Email Delivery**: No actual delivery to recipient inboxes
- **Email Standards**: No support for email authentication standards (SPF/DKIM/DMARC)

For production use, configure one of the supported third-party email services as described in the [Email Configuration Guide](./email-configuration-guide.md).

### Email Service Security

Beyond the local email server, the email service module implements these security measures:

1. **Email Validation**:
   - Comprehensive RFC 5322 compliant email validation
   - Checks for malformed addresses and potential injection vectors
   - Verification of domain format and prevention of common attack patterns
   - Blocked domains list for preventing disposable email abuse

2. **Context Sanitization**:
   - Deep sanitization of template context data to prevent XSS
   - Blocking of JavaScript protocol URLs
   - HTML entity encoding of dangerous characters
   - Type-specific sanitization for different data types
   - Protection against prototype pollution

3. **Rate Limiting**:
   - Configurable limits on email sending frequency
   - Prevention of email flooding attacks
   - IP-based and account-based rate limiting options

4. **Secure Transport**:
   - TLS enforcement for production email sending
   - Minimum TLS version requirements
   - Certificate validation

### Authentication Module Security

The authentication module includes these security features:

1. **Password Security**:
   - Password strength requirements enforcement
   - Argon2id hash algorithm with appropriate work factors
   - Protection against timing attacks
   - Prevention of common passwords and password reuse

2. **Token Management**:
   - Short-lived access tokens
   - Secure cookie settings (HttpOnly, Secure, SameSite)
   - Token rotation and refresh token mechanisms
   - Invalidation on security events

3. **Multi-factor Authentication**:
   - Optional TOTP-based second factor
   - Backup codes generation
   - Device fingerprinting

4. **Account Protection**:
   - Account lockout after failed attempts
   - Password reset with secure token delivery
   - Session invalidation after password changes
   - Login notifications

### Login Monitoring System

The application implements a comprehensive login monitoring and security system:

1. **Login Attempt Tracking**:
   - All login attempts (successful and failed) are recorded in the database
   - Tracked information includes:
     - Timestamp
     - IP address
     - User agent (browser/device info)
     - Geographic location (from IP)
     - Success/failure status
     - Username/email attempted
   - Admin interface for reviewing login history
   - Advanced filtering capabilities:
     - Email address
     - Time range
     - Geographic location
     - IP address

2. **Pattern Detection and Analysis**:
   - Real-time analysis of login patterns:
     - Rapid-fire attempts detection
     - Geographic anomaly detection
     - Time-based pattern analysis
     - IP reputation checking
   - Rejected attempts logged with detailed reason:
     - Rapid-fire detection (multiple attempts in quick succession)
     - Geographic anomalies (physically impossible travel patterns)
     - Suspicious timing patterns
     - Known malicious IP addresses

3. **Progressive Security Response**:
   - Graduated security measures based on threat level:
     - ALLOW: Normal login process
     - CAPTCHA: Self-hosted image verification
     - DELAY: Artificial response delay
     - TEMP_BLOCK: Temporary IP blocking
     - ALERT: Admin notification
   - Each level includes measures from previous levels

4. **Self-Hosted CAPTCHA System**:
   - Custom image-based CAPTCHA generation
   - No dependency on external services
   - Required for:
     - All login attempts after suspicious activity
     - New user registration
     - Password reset requests
   - Automatic difficulty adjustment based on threat level

5. **Real-time Alert System**:
   - Immediate email notifications to admin users for:
     - Multiple failed login attempts
     - Geographic anomalies
     - Suspicious IP activity
     - Temporary IP blocks
   - Future enhancements planned:
     - SMS notifications
     - Slack integration
     - Customizable alert rules

6. **Admin Dashboard Features**:
   - Real-time login attempt monitoring
   - Detailed attempt history with filtering
   - Geographic visualization of login attempts
   - IP reputation management
   - Manual IP blocking controls
   - Alert configuration

7. **IP Reputation System**:
   - Local IP reputation database
   - Integration with known IP blacklists
   - Automatic reputation scoring based on:
     - Failed login attempts
     - Suspicious patterns
     - Geographic anomalies
   - Manual override capabilities for administrators
   - IP Allowlist system for trusted addresses:
     - Environment-configurable allowlist
     - Bypass security restrictions for trusted IPs
     - Detailed logging of allowlist decisions
     - See [IP Allowlist Guide](./ip-allowlist-guide.md) for details

### Default Admin Account Security

The application implements strict security measures for the default admin account:

1. **Forced Password Change**:
   - First login requires immediate password change
   - Cannot access any admin features until password is changed
   - New password must meet enhanced security requirements:
     - Minimum 12 characters
     - Must include uppercase, lowercase, numbers, and special characters
     - Cannot be similar to default password
     - Cannot contain common patterns or dictionary words

2. **Rate Limiting and Blocking**:
   - Stricter rate limiting for default admin login attempts:
     - 3 failed attempts within 5 minutes: 15-minute lockout
     - 5 failed attempts within 15 minutes: 1-hour lockout
     - 10 failed attempts within 24 hours: 24-hour lockout
   - IP-based blocking:
     - Temporary IP blocking after failed attempts
     - Progressive blocking duration (15 mins → 1 hour → 24 hours)
     - Geographic location monitoring for suspicious access
   - Device fingerprinting:
     - Track and flag suspicious login patterns
     - Block unusual access patterns or locations
     - Require additional verification for new devices

3. **Access Monitoring**:
   - Real-time alerts for:
     - Failed login attempts
     - Password change events
     - Suspicious IP addresses
     - Unusual access patterns
   - Detailed audit logging:
     - All admin account activities
     - IP addresses and geolocation data
     - Device and browser information
     - Timestamp and duration of sessions

4. **Additional Security Measures**:
   - HTTP Security Headers:
     - Strict-Transport-Security (HSTS)
     - X-Content-Type-Options
     - X-Frame-Options
     - Content-Security-Policy
   - Session Security:
     - Automatic session termination after inactivity
     - Single active session policy
     - Session invalidation after password change
   - Request Validation:
     - CSRF token validation
     - Request origin verification
     - Input sanitization and validation

### API Security

The API layer implements these security measures:

1. **Request Validation**:
   - Schema-based validation of all requests
   - Content type restriction
   - Request size limiting
   - JSON parsing security

2. **Response Security**:
   - Information leakage prevention
   - Appropriate status codes
   - Error message sanitization
   - Security headers

3. **Rate Limiting and Throttling**:
   - Per-endpoint and global rate limits
   - IP-based and user-based throttling
   - Graduated response to abuse

4. **Monitoring**:
   - Logging of security events
   - Anomaly detection
   - Abuse pattern recognition

## Security Testing and Verification

The application includes several security testing tools and processes:

1. **Automated Security Tests**:
   - Email security tests verifying input validation and context sanitization
   - Authentication system penetration tests
   - API security verification tests

2. **Dependency Scanning**:
   - Regular scanning of dependencies for known vulnerabilities
   - Automatic updates for security patches
   - Vulnerability notification system

3. **Security Audit Tools**:
   - Static code analysis with security focus
   - Dynamic application security testing
   - Regular penetration testing procedures

To run the comprehensive security verification:

```bash
npm run security:audit
```

## Security Best Practices for Development

When developing or extending this application:

1. **Code Security**:
   - Follow the principle of least privilege
   - Validate all inputs, especially user-provided data
   - Use parameterized queries for database operations
   - Avoid using eval() or similar functions

2. **Dependency Management**:
   - Regularly update dependencies to patch security vulnerabilities
   - Verify the authenticity of packages before installation
   - Use lock files to ensure dependency consistency

3. **Sensitive Data**:
   - Never commit secrets, API keys, or credentials to version control
   - Use environment variables or secure secret storage
   - Implement proper data encryption for sensitive information

4. **Security Testing**:
   - Write tests for security-critical functionality
   - Include security checks in CI/CD pipelines
   - Perform regular security reviews of code changes

## Conclusion

This security guide provides an overview of the security measures implemented in the Angular Template Application and recommendations for secure deployment. Following these guidelines will help maintain a strong security posture for your application.

For specific configuration details related to email security, refer to the [Email Configuration Guide](./email-configuration-guide.md). 