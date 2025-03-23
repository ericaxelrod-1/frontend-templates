# Angular Template Application

## Overview

This project is a template for building modern Angular web applications with enterprise-grade features and best practices. It provides a solid foundation that you can customize and extend to build your own applications. Before using this template in production, some components need to be configured to match your specific requirements.

This project is a template application for Angular, designed to provide a solid foundation for building enterprise-grade web applications. It includes common features such as authentication, user management, and responsive layouts.

## Features

- User authentication (login, register, forgot password)
- Role-based access control
- User and group management
- Dashboard with analytics
- Material design components
- Responsive layout for all screen sizes
- State management with NGXS
- Comprehensive validation tools

## Deployment

For detailed instructions on deploying this application to a production environment, please refer to our [Deployment Guide](../docs/deployment-guide.md). This guide covers:

- Required deployment steps
- Running automated tests
- Security verification
- Email service configuration
- Environment setup
- Maintenance best practices

## Project Structure

The project follows a feature-based organization:

```
/src/app/
├── core/            # Core functionality (services, guards, interceptors)
├── shared/          # Shared components, directives, pipes
├── features/        # Feature modules
│   ├── auth/        # Authentication related components
│   ├── dashboard/   # Dashboard feature
│   ├── users/       # User management
│   └── groups/      # Group management
├── layouts/         # Layout components
└── models/          # Data models/interfaces
```

## Development

### Prerequisites

- Node.js (version 14 or higher)
- npm (version 6 or higher)
- Angular CLI (version 16 or higher)

### Installation

```bash
# Clone the repository
git clone https://github.com/organization/angular-template.git

# Navigate to the project directory
cd angular-template

# Install frontend dependencies
cd angular/frontend
npm install

# Install backend dependencies
cd ../backend
npm install
```

### Running the Application

#### Starting the Backend (NestJS)

```bash
# Navigate to the backend directory
cd angular/backend

# Development mode
npm run start:dev

# Debug mode with detailed logging
npm run start:debug

# Production mode
npm run start:prod
```

#### Starting the Frontend (Angular)

```bash
# Navigate to the frontend directory
cd angular/frontend

# Development mode
npm run start

# Development with verbose logging
npm run start -- --verbose

# Production build and serve locally
npm run build -- --configuration=production
npm run start -- --configuration=production

# Specify a different port (useful when running multiple instances)
npm run start -- --port=4201
```

### Running Both Frontend and Backend

For Windows (PowerShell):

```powershell
# Open two separate terminals and run:
# Terminal 1 (Backend):
cd angular/backend
npm run start:dev

# Terminal 2 (Frontend):
cd angular/frontend
npm run start
```

For Linux/Mac:

```bash
# Using concurrently (install with: npm install -g concurrently)
concurrently "cd angular/backend && npm run start:dev" "cd angular/frontend && npm run start"
```

### Build

```bash
# Build for production
npm run build
```

The build artifacts will be stored in the `dist/` directory.

## Code Quality

This project includes several tools to ensure code quality:

```bash
# Run style validation
npm run verify:styles

# Run layout validation
npm run verify:layouts

# Run all verification tools
npm run verify
```

## Documentation

Comprehensive documentation is available in the `docs/` directory:

- [Project Plan](docs/PROJECT_PLAN.md): Overview of the project architecture and features
- [Development Guide](docs/DEVELOPMENT_GUIDE.md): Guidelines for development
- [API Documentation](docs/API_DOCUMENTATION.md): Details about the backend API

## Testing

```bash
# Run unit tests
npm test

# Run unit tests with code coverage
npm test -- --code-coverage
```

## Contributing

Please read the [Development Guide](docs/DEVELOPMENT_GUIDE.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Security Features

The application implements various security features to protect user data and prevent attacks:

### Email Service Security

- **Input Validation**: All email addresses are rigorously validated before processing
- **Template Injection Protection**: Context data is sanitized to prevent XSS attacks
- **Rate Limiting**: Limits are placed on email sending to prevent abuse
- **Secure Password Reset Flow**: Password reset emails use secure tokens and validation
- **TLS Enforcement**: In production, TLS is enforced for all SMTP connections

### Testing Email Security

To run security tests for the email service:

```bash
# Navigate to the project directory
cd angular/frontend

# Run security tests
npm run security-test
```

### Debugging Email Service

The email service includes a comprehensive debug configuration for troubleshooting:

- **Console Logging**: View detailed logs during development
- **File Logging**: Enable persistent logs for debugging
- **Multiple Log Levels**: Control verbosity with configurable log levels

To enable debug mode:

```bash
# Enable debug mode
DEBUG=true npm run start

# Enable debug mode with file logging
DEBUG=true DEBUG_LOG_FILE=true npm run start
```

For more details, see the [Email Service Configuration README](server/email-service/config/README.md).

### Security Best Practices

- Set up environment variables for production deployment
- Never commit sensitive credentials to version control
- Run security tests regularly
- Keep dependencies updated to patch security vulnerabilities
