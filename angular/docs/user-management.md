# User Management System

## Overview

The User Management System is a core component of the Angular Template Application that handles all aspects of user accounts including creation, authentication, authorization, and maintenance. This document outlines the key features, workflows, and implementation details.

## User Creation Paths

There are two distinct paths for user account creation:

### 1. Self-Registration

Users can create their own accounts through the registration page.

**Process Flow:**
1. User navigates to the registration page
2. User provides email, password, and other required information
3. System validates the input according to security requirements
4. System creates the user account with basic user permissions
5. User receives email verification link
6. User verifies email to activate account
7. User can log in with created credentials

**Key Characteristics:**
- User chooses their own password initially
- Email verification is required before account activation
- Users start with basic permissions (typically 'USER' role)
- Self-registered users cannot join groups through self-service
- Password meets security requirements but doesn't require immediate change

### 2. Admin-Created Accounts

Administrators can create accounts for users through the admin interface.

**Process Flow:**
1. Admin logs in with administrative privileges
2. Admin navigates to user management section
3. Admin provides new user's details (email, name, etc.)
4. System generates a secure temporary password or admin sets one
5. System creates user account with specified roles/permissions
6. System flags the account for password change on first login
7. User receives welcome email with login credentials (optional)
8. User logs in and is prompted to change password immediately

**Key Characteristics:**
- Admin can assign roles and permissions during creation
- Admin can add user to groups during creation
- System flags account for mandatory password change
- User must change password on first login before accessing features
- The password change requirement is not tied to specific accounts but to a flag

## Password Change Requirements

The password change requirement is implemented as a flag in the user record (`requiresPasswordChange`), not hardcoded to specific accounts.

### Implementation Details

1. **User Model:**
```typescript
export interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  groups: { id: number; name: string }[];
  requiresPasswordChange: boolean;
  lastPasswordChange?: Date;
}
```

2. **Password Change Flow:**
   - After login, the system checks the `requiresPasswordChange` flag
   - If true, the user is redirected to a password change page
   - User cannot access any other part of the application until the password is changed
   - After successful password change, flag is set to false
   - `lastPasswordChange` field is updated with current timestamp

3. **Password Security Requirements:**
   - Minimum length (typically 12+ characters)
   - Must include uppercase, lowercase, numbers, and special characters
   - Cannot be similar to previous passwords
   - Cannot contain common patterns or dictionary words
   - Password history is maintained to prevent reuse

## Security Implementation

### Login Protection

The system implements progressive security measures to protect user accounts:

1. **Rate Limiting:**
   - 3 failed attempts: Captcha required
   - 5 failed attempts: 15-minute lockout
   - 10 failed attempts: 24-hour lockout

2. **Suspicious Activity Detection:**
   - Unusual login times or locations trigger additional verification
   - Failed login patterns are analyzed for attack detection
   - IP reputation tracking blocks known malicious sources

### Account Recovery

1. **Password Reset Process:**
   - User requests password reset via email
   - System sends a time-limited reset token
   - Token validity is typically 1 hour
   - After reset, user must set a new password meeting requirements
   - System logs all password reset attempts

## Testing & Validation

Automated testing ensures the user management system functions correctly:

1. **Unit Tests:**
   - User creation validation
   - Password strength validation
   - Role assignment validation
   - Password change requirement validation

2. **Integration Tests:**
   - Admin user creation flow
   - Self-registration flow
   - Password change requirement enforcement
   - Role-based access control

3. **End-to-End Tests:**
   - Complete user journey for both creation paths
   - Password change workflow
   - Account recovery process

## Automated Tests

The following automated tests ensure the reliability and security of the User Management System:

### Backend Tests

#### UserService Tests

1. **User Creation Tests:**
```typescript
describe('UserService - User Creation', () => {
  it('should create user with requiresPasswordChange flag when created by admin', async () => {
    // Test implementation
  });

  it('should not set requiresPasswordChange flag for self-registered users', async () => {
    // Test implementation
  });

  it('should validate password complexity during user creation', async () => {
    // Test implementation
  });

  it('should not allow duplicate email addresses', async () => {
    // Test implementation
  });
});
```

2. **Password Change Tests:**
```typescript
describe('UserService - Password Change', () => {
  it('should update lastPasswordChange timestamp when password is changed', async () => {
    // Test implementation
  });

  it('should reset requiresPasswordChange flag after successful password change', async () => {
    // Test implementation
  });

  it('should reject weak passwords during password change', async () => {
    // Test implementation
  });

  it('should prevent password reuse', async () => {
    // Test implementation
  });
});
```

3. **User Management Tests:**
```typescript
describe('UserService - User Management', () => {
  it('should allow admins to update user roles', async () => {
    // Test implementation
  });

  it('should prevent users from updating their own roles', async () => {
    // Test implementation
  });

  it('should enforce role-based access control', async () => {
    // Test implementation
  });
});
```

### Frontend Tests

#### User Creation Component Tests

1. **AdminUserCreateComponent Tests:**
```typescript
describe('AdminUserCreateComponent', () => {
  it('should display requiresPasswordChange toggle for admin users', () => {
    // Test implementation
  });

  it('should send correct API request with requiresPasswordChange flag', () => {
    // Test implementation
  });

  it('should show success message after user creation', () => {
    // Test implementation
  });

  it('should validate all required fields', () => {
    // Test implementation
  });
});
```

2. **RegistrationComponent Tests:**
```typescript
describe('RegistrationComponent', () => {
  it('should validate password complexity', () => {
    // Test implementation
  });

  it('should require email verification', () => {
    // Test implementation
  });

  it('should show appropriate error messages for each validation rule', () => {
    // Test implementation
  });
});
```

3. **PasswordChangeComponent Tests:**
```typescript
describe('PasswordChangeComponent', () => {
  it('should validate new password meets complexity requirements', () => {
    // Test implementation
  });

  it('should require current password for existing users', () => {
    // Test implementation
  });

  it('should not require current password for users with requiresPasswordChange=true', () => {
    // Test implementation
  });

  it('should navigate to dashboard after successful password change', () => {
    // Test implementation
  });
});
```

### End-to-End Tests

1. **Admin User Creation Flow:**
```typescript
describe('Admin User Creation', () => {
  it('should allow admin to create user that requires password change', () => {
    // Navigate to admin portal
    // Create new user with 'requires password change' set to true
    // Verify user is created successfully
    // Verify welcome email is sent
  });

  it('should enforce password change on first login for admin-created accounts', () => {
    // Login as newly created user
    // Verify redirect to password change page
    // Change password
    // Verify navigation to dashboard afterwards
    // Verify requiresPasswordChange flag is reset
  });
});
```

2. **Self-Registration Flow:**
```typescript
describe('Self-Registration', () => {
  it('should allow users to self-register and verify email', () => {
    // Navigate to register page
    // Fill out registration form
    // Submit form
    // Verify confirmation screen
    // Simulate clicking email verification link
    // Verify account activation
  });

  it('should not require password change for self-registered users', () => {
    // Login as newly registered user
    // Verify direct navigation to dashboard (no password change redirect)
  });
});
```

3. **Password Security Tests:**
```typescript
describe('Password Security', () => {
  it('should reject weak passwords', () => {
    // Test various weak password combinations
    // Verify appropriate error messages
  });

  it('should prevent password reuse', () => {
    // Change password
    // Try to change to previous password
    // Verify rejection
  });

  it('should lock account after multiple failed attempts', () => {
    // Attempt multiple failed logins
    // Verify account lockout
    // Verify unlock after timeout
  });
});
```

### Test Coverage Goals

The test suite aims to achieve the following coverage metrics:

- Line Coverage: 90%+
- Branch Coverage: 85%+
- Function Coverage: 95%+
- Statement Coverage: 90%+

Specific focus areas include:
- Password validation logic (100% coverage)
- Role-based access control (100% coverage)
- Security-critical flows like password change (100% coverage)
- Error handling paths (90%+ coverage)

## Future Enhancements

### Welcome Email with Login Token

1. **Implementation Plan:**
   - Extend UserService to generate one-time login tokens
   - Create email template for welcome messages
   - Add configuration option to enable/disable feature
   - Implement token validation and automatic login
   - Add audit logging for token usage

2. **User Experience:**
   - New user receives email with welcome message
   - Email contains a secure one-time login link
   - User clicks link and is taken directly to password change screen
   - After setting password, user continues to application
   - Token expires after first use or 24 hours

3. **Security Considerations:**
   - Tokens are cryptographically secure and single-use
   - Tokens include user ID and expiration time, signed with application secret
   - All token usage is logged for audit purposes
   - IP verification can be added as additional security layer

## Administration Interface

The user management interface provides administrators with:

1. **User Listing:**
   - View all users with filtering and sorting
   - Status indicators for verification, locked accounts, etc.
   - Quick access to user details and actions

2. **User Creation:**
   - Form for adding new users with all required fields
   - Role and group assignment options
   - Toggle for password change requirement

3. **User Editing:**
   - Update user details and permissions
   - Manage group memberships
   - Reset passwords or lock accounts
   - View audit history

4. **Batch Operations:**
   - Add multiple users via CSV upload
   - Bulk role assignments
   - Bulk group assignments

## Best Practices

1. **Permission Management:**
   - Use role-based access control (RBAC) for permissions
   - Assign minimal necessary permissions
   - Regularly audit user access and permissions

2. **Security:**
   - Never store plain text passwords
   - Use strong hashing algorithms (bcrypt) for password storage
   - Implement proper input validation for all user data
   - Protect against common vulnerabilities (SQL injection, XSS, CSRF)

3. **Privacy:**
   - Only collect necessary user information
   - Provide clear privacy policy and data usage information
   - Implement data protection measures
   - Support user data export and account deletion

# User Management

This document provides detailed information about user management features in the Angular Template Application, including user creation methods and role-based permissions.

## User Creation Methods

The application supports multiple methods for creating user accounts:

### 1. Self-Registration

Users can create their own accounts through the registration page:

- **Process**:
  - User fills out the registration form with email, password, and profile information
  - Email verification is required to activate the account
  - Initial role assignment: Basic "USER" role
  - Cannot self-assign administrative privileges

- **Security Measures**:
  - Email verification prevents unauthorized registrations
  - CAPTCHA protection prevents automated account creation
  - Rate limiting prevents abuse of registration endpoint
  - Domain restrictions can be configured to limit registration to specific email domains

### 2. Admin-Created Accounts

Administrators can create accounts for other users:

- **Process**:
  - Admin creates account with user's email and temporary password
  - System generates a secure random password if not provided
  - Email notification sent to new user with account details
  - Password change required on first login
  - Admin can assign appropriate roles during creation

- **Security Measures**:
  - Admin audit logs track all account creations
  - Temporary passwords expire after first use
  - Mandatory password change with enhanced security requirements
  - Rate limiting on admin account creation to prevent abuse

### 3. Bulk Account Import

For organizational deployments, bulk user import is available:

- **Process**:
  - Admin uploads CSV/JSON file with user details
  - System validates all entries before processing
  - Invalid entries are rejected with detailed error reports
  - Successfully imported users receive welcome emails
  - Rate limiting enforced on bulk operations

- **Security Measures**:
  - Input validation for all imported data
  - Limits on batch size to prevent system overload
  - Admin approval required for large imports
  - Complete audit logging of all import activities

## Role-Based Permissions

The application implements role-based access control (RBAC) with the following predefined roles:

### 1. USER (Default)

The basic role assigned to all registered users:

- **Permissions**:
  - Access personal dashboard
  - View and edit own profile
  - View shared resources
  - Participate in assigned groups
  - Cannot access administrative features

- **Assignment**:
  - Auto-assigned during self-registration
  - Can be assigned by admins

### 2. PROJECT_MANAGER

Mid-level administrative role for managing projects and teams:

- **Permissions**:
  - All USER permissions
  - Create and manage groups
  - Add/remove users from groups
  - Assign tasks to users
  - View basic user reports

- **Assignment**:
  - Can only be assigned by ADMIN or SUPERADMIN
  - Requires additional verification

### 3. ADMIN

Primary administrative role for general system management:

- **Permissions**:
  - All PROJECT_MANAGER permissions
  - Create user accounts
  - Manage user roles (except SUPERADMIN)
  - Access security monitoring features
  - View system logs
  - Configure application settings
  - Manage role-based access
  - Access login monitoring system

- **Assignment**:
  - Can only be assigned by SUPERADMIN
  - Requires strong authentication
  - Assignment is logged and audited

### 4. SUPERADMIN

Highest level administrative role with complete system access:

- **Permissions**:
  - All ADMIN permissions
  - Assign and revoke ADMIN role
  - Configure critical system settings
  - Access all security features
  - View all audit logs and security reports
  - Override security restrictions (with proper logging)
  - Full access to all features

- **Assignment**:
  - Reserved for primary system administrators
  - Usually assigned during initial system setup
  - Additional SUPERADMIN accounts require existing SUPERADMIN approval
  - Assignment requires two-factor authentication
  - All activities extensively logged

## Role Assignment Rules

The following rules govern who can assign different roles:

| Role to Assign | Can be Assigned By |
|----------------|-------------------|
| USER           | Self-registration, PROJECT_MANAGER, ADMIN, SUPERADMIN |
| PROJECT_MANAGER| ADMIN, SUPERADMIN |
| ADMIN          | SUPERADMIN |
| SUPERADMIN     | SUPERADMIN (with additional verification) |

## Dashboard Access Permissions

The dashboard provides access to different cards based on user roles:

| Dashboard Card | Required Roles |
|----------------|----------------|
| Users          | USER, PROJECT_MANAGER, ADMIN, SUPERADMIN |
| Groups         | PROJECT_MANAGER, ADMIN, SUPERADMIN |
| Activity       | ADMIN, SUPERADMIN |

## User Management Best Practices

When managing users in the application, follow these best practices:

1. **Principle of Least Privilege**:
   - Assign the minimum role required for a user's job function
   - Regularly review and audit role assignments
   - Remove unnecessary permissions when no longer needed

2. **Regular Access Reviews**:
   - Conduct quarterly reviews of user access
   - Verify that departing employees have accounts deactivated
   - Check for dormant accounts with elevated privileges

3. **Separation of Duties**:
   - Distribute administrative responsibilities among multiple people
   - Use approval workflows for critical actions
   - Require additional verification for sensitive operations

4. **Documentation**:
   - Maintain records of role assignments
   - Document reasons for elevated privilege assignments
   - Keep an audit trail of permission changes

5. **Security Awareness**:
   - Train users on security best practices
   - Educate administrators on security implications of role assignments
   - Provide clear guidelines for secure user management 