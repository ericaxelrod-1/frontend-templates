# Angular Template Application

## Overview
This project serves as a template for deploying new Angular applications with a NestJS backend and SQLite database (with migration path to PostgreSQL).

## Features
- **Authentication**: User registration, login, and role-based access control
- **User Management**: Regular users, Superusers, and Superadmins
- **Group System**: Support for user groups with data/asset sharing
- **User Emulation**: Superadmins and Superusers can view the application from a regular user's perspective
- **Responsive Design**: Mobile and tablet friendly UI
- **Modular Architecture**: Reusable components and feature modules
- **Comprehensive Logging**: Debug mode and 7-day log rotation

## Technical Stack
- **Frontend**: Angular with NGXS state management
- **Backend**: NestJS
- **Database**: SQLite (migration path to PostgreSQL)
- **Deployment**: Docker containers

## Getting Started

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

## Running the Application

The application consists of two parts - a frontend Angular application and a backend NestJS server. Both need to be running simultaneously.

### Development Environment

#### Standard Development Mode

**When to use:** Day-to-day development work - default for most development tasks

**Terminal 1 - Backend:**
```bash
cd angular/backend
npm run start:dev
```

**Terminal 2 - Frontend:**
```bash
cd angular/frontend
npm start   # or ng serve
```

**Configuration files used:**
- Backend: `.env.development` - Enables database writes, sets dev JWT secrets
- Frontend: `environment.ts` - Default Angular environment

#### Debug Mode

**When to use:** When troubleshooting application logic issues, API integrations, or state management

**Terminal 1 - Backend:**
```bash
cd angular/backend && npm run start:dev -- --debug
```

**Terminal 2 - Frontend:**
```bash
cd angular/frontend && npm start -- --configuration=development
```

**Configuration files used:**
- Backend: `.env.development` (with DEBUG=true) - Enhanced logging 
- Frontend: `environment.development.ts` - Source maps and debug settings

#### Verbose Build Mode

**When to use:** When debugging build problems, module resolution issues, or optimizing build performance

**Terminal 1 - Backend:**
```bash
cd angular/backend
npm run start:dev
```

**Terminal 2 - Frontend:**
```bash
cd angular/frontend
npm start -- --verbose
```

**Configuration files used:**
- Backend: `.env.development` - Standard development settings
- Frontend: `environment.ts` with verbose Angular CLI output

#### Rapid UI Development Mode (HMR)

**When to use:** When focused on UI/UX changes and front-end component development

**Terminal 1 - Backend:**
```bash
cd angular/backend && npm run start:dev -- --hmr
```

**Terminal 2 - Frontend:**
```bash
cd angular/frontend && npm start -- --hmr
```

**Configuration files used:**
- Backend: `.env.development` - Standard development settings
- Frontend: `environment.ts` with Hot Module Replacement enabled

### Testing Environment

**When to use:** When running automated tests or creating test data

**Terminal 1 - Backend:**
```bash
cd angular/backend
npm run test
```

**Terminal 2 - Frontend (if needed):**
```bash
cd angular/frontend
npm run test
```

**Configuration files used:**
- Backend: `.env.test` - In-memory DB, test settings
- Frontend: `environment.ts` with testing configuration

### Production Simulation

**When to use:** When testing production builds, performance, or optimizations

**Terminal 1 - Backend:**
```bash
cd angular/backend
npm run start:prod
```

**Terminal 2 - Frontend:**
```bash
cd angular/frontend
npm start -- --configuration=production
```

**Configuration files used:**
- Backend: `.env` - Production configuration
- Frontend: `environment.production.ts` - Production settings

### Configuration Files Location

- Backend environment files:
  - `.env` - `angular/backend/.env`
  - `.env.development` - `angular/backend/.env.development`
  - `.env.test` - `angular/backend/.env.test`

- Frontend environment files: 
  - `environment.ts` - `angular/frontend/src/environments/environment.ts`
  - `environment.development.ts` - `angular/frontend/src/environments/environment.development.ts`

### Access Points

- Frontend: http://localhost:4200
- Backend API: http://localhost:3000
- API Documentation: http://localhost:3000/api

### 5. Additional Features

- Interactive API documentation available at http://localhost:3000/api
- SQLite database used by default (file: `angular/backend/db.sqlite`)
- Comprehensive logging in debug mode
- Frontend options can be combined for specific needs

## Development Server Modes

### Standard Development Mode
```bash
# Frontend
npm start
# or
ng serve
```
Use this for regular development. It provides:
- Live reload on file changes
- Basic error reporting
- Default development configuration

### Debug Mode
```bash
# Frontend
# executed in angular/frontend
npm start -- --configuration=development
# or
ng serve --configuration=development
```
Use this when you need to debug application issues:
- More detailed console output
- Source maps for debugging in browser dev tools
- Enables Angular's debug tools for component inspection

### Verbose Mode
```bash
# Frontend
npm start -- --verbose
# or
ng serve --verbose
```
Use this when you need detailed build information:
- Shows full compilation process logs
- Displays webpack configuration details
- Helpful for troubleshooting build issues or optimizing build performance

### Production Simulation Mode
```bash
# Frontend
npm start -- --configuration=production
# or
ng serve --configuration=production
```
Use this to test how your app will behave in production:
- Applies production optimization (bundling, minification)
- Disabled debug tools
- Disabled verbose logging
- Performance testing environment

### Hot Module Replacement (HMR) Mode
```bash
# Frontend
npm start -- --hmr
# or
ng serve --hmr
```
Use this for faster development iterations:
- Updates modules in-place without full page refresh
- Preserves application state during updates
- Speeds up development workflow for UI-heavy work

### Combined Options
You can combine these options as needed:
```bash
# Debug + Verbose + HMR
ng serve --configuration=development --verbose --hmr
```

### Backend Development Modes
```bash
# Standard development
npm run start:dev

# Debug mode (enables detailed logging)
npm run start:dev -- --debug

# Watch mode (automatically restarts on file changes)
npm run start:debug
```

The server will start at http://localhost:4200 for frontend and http://localhost:3000 for backend by default.

### API Documentation
The API documentation is available at http://localhost:3000/api when the server is running. This interactive documentation includes:
- All available endpoints
- Request/response schemas
- Authentication requirements
- Example requests and responses
- Try-it-out functionality

## Future Enhancements
- Advanced authentication (email verification, MFA, social login)
- Unit, Integration and e2e tests
- Internationalization 
- - Multi-language support
- - RTL layout support
- - Localization feature
- Accessibility compliance
- - WCAG compliance implementation
- - Screen reader optimizations
- - Keyboard navigation enhancements
- Third-party integrations
- Performance monitoring

### Angular Material Implementation
- Material Design component integration
- Custom theming with Material Design palette
- Material CDK for advanced interactions
- Pre-built layout templates and schematics

### Progressive Web App Features
- **Service Worker Implementation**
  - Offline capability with configurable caching strategies
  - Background sync for offline operations
  - Push notifications support
  - Update management with user prompts
- **App Manifest Configuration**
  - Home screen installation support
  - Custom icons and splash screens
  - Orientation and display mode settings
  - Theme color configuration

### Error Tracking System
- Global error handling with detailed reporting
- Integration with monitoring services (Sentry, LogRocket)
- User feedback collection for errors
- Error analytics and trend identification
- Automatic retry mechanisms for transient failures

## Security Features
- CSRF protection
- Rate limiting
- Strict password rules

## Browser Compatibility
- Chrome, Firefox, Safari (desktop/mobile/tablet)

## Future Considerations

### Analytics and Monitoring
- Application performance monitoring
- User behavior analytics
- Error tracking and reporting dashboards
- Real-time monitoring of system health

### Backup and Disaster Recovery
- Database backup strategies
- Data recovery procedures
- High availability options
- Automated backup verification

### API Versioning Strategy
- How to handle API changes over time
- Backward compatibility considerations
- Deprecation policies
- API documentation strategies

### Offline Functionality
- Service worker implementation
- Offline data synchronization
- Cache strategies for offline access
- Background synchronization when connection is restored

### SEO Considerations
- Server-side rendering for improved indexing
- Metadata optimization
- Structured data implementation
- Performance optimizations for Core Web Vitals

### Advanced Security Measures
- Regular security audits
- Penetration testing procedures
- Compliance with standards (GDPR, HIPAA, etc.)
- Security incident response plan

### Data Import/Export
- User data portability
- Bulk import/export functionality
- Export formats (CSV, JSON, etc.)
- Scheduled data exports

## Environment Configuration

The application uses different environment configuration files depending on the execution context:

### Environment Files

| File | Purpose | Used By |
|------|---------|---------|
| `.env` | Default/Production settings | `npm run start:prod` |
| `.env.development` | Development settings | `npm run start:dev`, `npm run start:debug` |
| `.env.test` | Testing environment settings | `npm run test`, `npm run test:e2e` |

### Key Environment Settings

#### Development Mode

When running in development mode, the following important settings are configured:

- `DATABASE_WRITE_ENABLED=true` - Enables database writes during development
- `DATABASE_SYNCHRONIZE=true` - Automatically updates the database schema
- `DEBUG=true` - Enables detailed logging
- `JWT_SECRET=dev-secret-key-not-for-production` - Development JWT secret (not secure for production)

This ensures you can test the full application flow, including:
- User registration with database persistence
- Email verification
- Role assignments and permissions
- Group creation and membership

#### Testing Mode

In testing mode:
- In-memory SQLite database (`:memory:`)
- Automatic schema synchronization
- Separate port (3001) to avoid conflicts with development server

#### Overriding Environment Variables

You can override any environment variable:

```bash
# Example: Disable database writes for specific development session
DATABASE_WRITE_ENABLED=false npm run start:dev

# Example: Use a different database file
DATABASE_FILE=custom.sqlite npm run start:dev
```

#### Database Write Behavior

The `DATABASE_WRITE_ENABLED` flag controls database write operations in development:

- When `true` (default in `.env.development`): Full database functionality including creating users, verifying email, assigning roles, etc.
- When `false`: Database operations are simulated but not persisted 

## Angular CLI Flags vs. Environment Files

This application uses two separate configuration systems:

### 1. Angular CLI Flags

These flags control the frontend build and serve process:

- `--verbose`: Enables detailed build logging
  ```bash
  ng serve --verbose
  ```
  This shows webpack configuration, module resolution, and compilation details.
  **Note**: This does not interact with `.env` files - it only affects build output verbosity.

- `--hmr`: Enables Hot Module Replacement
  ```bash
  ng serve --hmr
  ```
  Allows code changes to be applied without full page reloads.

- `--configuration`: Selects an Angular environment configuration
  ```bash
  ng serve --configuration=development
  ```
  This selects Angular's environment.development.ts file (frontend), not backend .env files.

### 2. Environment Files (Backend)

These files configure the backend application:

- `.env`: Default/production settings
- `.env.development`: Development server settings
- `.env.test`: Testing environment settings

Each file sets environment variables like `DATABASE_WRITE_ENABLED`, `JWT_SECRET`, etc.

### Common Development Workflow

Typically, you'll use both systems together:

```bash
# Terminal 1: Start backend with development environment
cd angular/backend
npm run start:dev  # Uses .env.development for database configuration

# Terminal 2: Start frontend with CLI flags
cd angular/frontend
ng serve --verbose --hmr  # Uses CLI flags for build process
``` 