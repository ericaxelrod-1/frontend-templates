# Angular Template Application

A modern Angular template application for quickly building new projects. This template includes authentication (login, registration, password reset), email verification, user management, role-based authorization, and an admin dashboard.

## Features

- **Authentication**: Login, registration, and password reset
- **Email Verification**: Verify new user accounts via email
- **User Management**: User profile, account settings
- **Role-Based Authorization**: Control access with user roles
- **Admin Dashboard**: Manage users, roles, and permissions
- **Modern Angular**: Built with the latest Angular version
- **Material Design**: UI components from Angular Material
- **Responsive Layout**: Works on desktop, tablet, and mobile
- **Dark Mode Support**: Toggle between light and dark themes
- **RESTful API Integration**: Ready-to-use API service
- **State Management**: NGXS state management
- **Cookie Consent**: GDPR-compliant cookie consent system with customizable preferences

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

### Development Server

1. Start the backend server:
   ```bash
   cd backend
   npm run start:dev
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
cd frontend
npm start
# or
ng serve
```

2. **Debug Mode**
```bash
cd frontend
npm start -- --configuration=development
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
cd backend
npm run start:dev -- --debug
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