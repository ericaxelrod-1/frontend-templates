# Angular Template Application

A modern Angular template application for quickly building new projects. This template includes authentication (login, registration, password reset), email verification, user management, role-based authorization, and an admin dashboard.

## Features

- **Authentication**: Login, registration, and password reset
- **Email Verification**: Verify new user accounts via email
- **User Management**: User profile, account settings, [detailed documentation](./docs/user-management.md)
- **Role-Based Authorization**: Control access with user roles
- **Admin Dashboard**: Manage users, roles, and permissions
- **Modern Angular**: Built with the latest Angular version
- **Material Design**: UI components from Angular Material
- **Responsive Layout**: Works on desktop, tablet, and mobile
- **Dark Mode Support**: Toggle between light and dark themes
- **RESTful API Integration**: Ready-to-use API service
- **State Management**: NGXS state management
- **Cookie Consent**: GDPR-compliant cookie consent system with customizable preferences

## Dashboard Features

The application dashboard presents actionable cards based on user roles:

| Card     | Description                               | Required Roles                            |
|----------|-------------------------------------------|-------------------------------------------|
| Users    | View and manage user accounts             | USER, PROJECT_MANAGER, ADMIN, SUPERADMIN  |
| Groups   | Manage user groups and assignments        | PROJECT_MANAGER, ADMIN, SUPERADMIN        |
| Activity | Access security monitoring and login logs | ADMIN, SUPERADMIN                         |

For detailed information about user roles and permissions, see the [User Management documentation](./docs/user-management.md).

## Getting Started

Follow these steps to set up the project for development:

### Prerequisites

- Node.js (v14 or later)
- npm (v6 or later)
- Angular CLI (v13 or later)

### Installation

1. Clone the repository
2. Install dependencies for the frontend:
   ```bash
   cd frontend
   npm install
   ```
3. Install dependencies for the backend:
   ```bash
   cd ../backend
   npm install
   ```

### Default User Accounts

The application comes with three default user accounts for different permission levels:

#### 1. Superadmin Account (Full Administrative Access)

- **Username**: admin@example.com
- **Password**: Admin123!
- **Role**: SUPERADMIN
- **Access**: All features, including Users, Groups, Activity, and all admin functions
- **Permissions**: Can create/delete users, assign any role, access security features

#### 2. Project Manager Account

- **Username**: manager@example.com
- **Password**: Manager123!
- **Role**: PROJECT_MANAGER
- **Access**: Users, Groups, and management features
- **Permissions**: Can manage groups and regular users

#### 3. Regular User Account

- **Username**: user@example.com
- **Password**: User123!
- **Role**: USER
- **Access**: Basic user features only
- **Permissions**: Can only manage own profile

⚠️ **IMPORTANT**: The application enforces strict security measures for the admin accounts:

1. **Mandatory Password Change**:
   - You will be required to change the password on first login
   - No admin features will be accessible until the password is changed
   - The new password must meet enhanced security requirements:
     - Minimum 12 characters
     - Must include uppercase, lowercase, numbers, and special characters
     - Cannot be similar to the default password
     - Cannot contain common patterns or dictionary words

2. **Login Protection**:
   - Strict rate limiting is enforced:
     - 3 failed attempts: 15-minute lockout
     - 5 failed attempts: 1-hour lockout
     - 10 failed attempts: 24-hour lockout
   - IP addresses will be temporarily blocked after failed attempts
   - Suspicious access patterns will trigger additional verification
   - All login attempts are logged and monitored

For complete security documentation, including all implemented protections and best practices, see the [Security Guide](./docs/security.md).

### Development Server

1. Start the backend server:
   ```bash
   cd angular/backend &&  npm run start:dev
   ```
2. In a new terminal, start the frontend server:
   ```bash
   cd frontend
   npm start
   ```
3. Navigate to `http://localhost:4200/` in your browser

## Development Modes

### Frontend Development Modes

1. **Standard Development Mode**
```bash
cd frontend npm start
# or
ng serve
```

2. **Debug Mode**
```bash
cd angular/frontend && npm start -- --configuration=development
# or
ng serve --configuration=development
```

3. **Verbose Mode**
```bash
cd frontend
npm start -- --verbose
# or
ng serve --verbose
```

4. **Production Simulation Mode**
```bash
cd frontend
npm start -- --configuration=production
# or
ng serve --configuration=production
```

### Backend Development Modes

1. **Standard Development Mode**
```bash
cd backend
npm run start:dev
```

2. **Debug Mode**
```bash
cd angular\backend && npm run start:dev -- --debug
```

3. **Watch Mode**
```bash
cd backend
npm run start:debug
```

## Configuration

The application can be configured through environment files:

### Frontend

- `src/environments/environment.ts` - Development configuration
- `src/environments/environment.prod.ts` - Production configuration

### Backend

- `.env` - Default/Production environment variables
- `.env.development` - Development environment variables
- `.env.test` - Testing environment variables

## Logging System

The application implements comprehensive logging across both frontend and backend components:

- **Frontend Logs**: Daily rotating logs for component lifecycle events, user interactions, and API calls
- **Backend Logs**: Application events, audit trails, and error tracking with automatic rotation
- **Log Levels**: ERROR, WARN, INFO, DEBUG, and TRACE with configurable verbosity
- **Development Tools**: Built-in debugging components and logging middleware

For detailed information about the logging system, debugging tools, and best practices, see the [Debugging and Logging Guide](./docs/DEBUGGING_LOGGING.md).

## Cookie Consent System

The template includes a fully-featured cookie consent system that:

- Complies with GDPR and CCPA privacy regulations
- Allows users to customize their cookie preferences
- Categorizes cookies into four types: Necessary, Preference, Analytics, and Marketing
- Respects user choices for each cookie category
- Optionally stores preferences with user accounts for a consistent experience

See the [Cookie Management Guide](./docs/cookies.md) for implementation details.

## Authentication

The application includes a complete authentication system:

- User registration with email verification
- Email-based password reset
- JWT authentication with refresh tokens
- Remember me functionality
- Session management
- Protection against common security vulnerabilities

## User Management

Users can:

- Update their profile information
- Change their password
- Manage email preferences
- Delete their account

For detailed information about user management, including password requirements and account creation workflows, see the [User Management Guide](./docs/user-management.md).

## Admin Features

Administrators can:

- View and manage users
- Assign roles to users
- Create and manage user groups
- View system logs
- Configure system settings

## API Documentation

The API documentation is available at `http://localhost:3000/api` when running the backend server.

## Custom Styling

The application uses Angular Material for UI components with a custom theme. You can customize the appearance by modifying:

- `src/styles.scss` - Global styles
- `src/theme.scss` - Theme configuration
- `src/variables.scss` - Shared variables

## Deployment

For detailed deployment instructions, see the [Deployment Guide](./docs/deployment-guide.md).

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Angular Team for the amazing framework
- Angular Material Team for the UI components
- NGXS Team for the state management library
- All contributors who have helped improve this template 