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

### 2. Starting the Servers

Both servers need to be running simultaneously in separate terminal windows:

#### Frontend Modes

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
cd angular/frontend && ng serve --configuration=development --verbose --hmr
```
- Use for: Advanced development needs
- Combines multiple features for specific use cases

#### Backend Modes

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
cd angular/backend && npm run start:dev -- --debug
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

### Production Simulation
```bash
# Frontend
npm start -- --configuration=production
# or
ng serve --configuration=production
```
Use this to test how your app will behave in production:
- Applies production optimization (bundling, minification)
- Disables debug tools and verbose logging
- Useful for performance testing before deployment

### Hot Module Replacement Mode
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