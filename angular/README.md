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
1. Clone this repository
2. Install dependencies
   ```
   # Frontend
   cd frontend
   npm install

   # Backend
   cd ../backend
   npm install
   ```
3. Start the development servers
   ```
   # Frontend
   cd frontend
   npm start

   # Backend
   cd ../backend
   npm run start:dev
   ```

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