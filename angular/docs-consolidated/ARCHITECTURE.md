# Architecture Documentation

## Project Overview

This is a modern Angular application with a NestJS backend that features a comprehensive, fully dynamic database-driven access control system.

### Key Features

- **Dynamic Permission System**: Completely database-driven access control without any hardcoded permissions
- **UI Component Registration**: Automatic discovery and registration of UI components with permissions
- **Dynamic Route Protection**: Database-defined protection for application routes
- **API Endpoint Security**: Dynamic permission checks for backend endpoints
- **Hierarchical Permissions**: Full inheritance support for roles, groups, and nested components
- **Performance Optimization**: SQLite cache database for high-performance permission checks
- **Admin Interface**: Complete management UI for permissions across all application elements
- **Angular Frontend**: Modern, responsive UI built with Angular
- **NestJS Backend**: Robust API with TypeScript support
- **TypeORM Integration**: Database ORM for entity management

## Project Structure

This document outlines the structure of the Angular project, explaining the purpose and content of each directory.

### Root Structure

```
angular/
├── frontend/         # Angular frontend application
├── backend/          # NestJS backend application
├── docs/             # Project documentation
├── scripts/          # Project-wide utility scripts
├── migration/        # Database and permission migration scripts
```

### Frontend Structure (`angular/frontend/`)

#### Purpose
Contains the Angular application that handles the client-side presentation, routing, and user interactions.

#### Main Directories

```
frontend/
├── src/              # Source code for the Angular application
│   ├── app/          # Angular components, services, and modules
│   │   ├── components/    # Shared components
│   │   ├── core/          # Core services, guards, and interceptors
│   │   ├── features/      # Feature modules and components
│   │   ├── layouts/       # Layout components (headers, footers)
│   │   ├── models/        # TypeScript interfaces and type definitions
│   │   ├── modules/       # Angular modules
│   │   ├── pages/         # Page components
│   │   ├── services/      # Application services
│   │   ├── shared/        # Shared utilities, pipes, directives
│   │   └── store/         # State management
│   ├── assets/       # Static assets (images, fonts)
│   ├── environments/ # Environment configuration
│   └── styles/       # Global styles and themes
├── dist/             # Compiled output (generated)
├── node_modules/     # NPM dependencies (generated)
├── docs/             # Frontend-specific documentation
├── tools/            # Frontend build tools and utilities
└── .angular/         # Angular CLI cache (generated)
```

#### File Types
- **TypeScript (.ts)**: Angular components, services, modules
- **HTML (.html)**: Angular templates
- **SCSS (.scss)**: Styling
- **Spec (.spec.ts)**: Unit tests
- **JSON (.json)**: Configuration files
- **JavaScript (.js)**: Build and configuration scripts

### Backend Structure (`angular/backend/`)

#### Purpose
Provides the server-side API, authentication, database access, and business logic using NestJS.

#### Main Directories

```
backend/
├── src/                  # Source code for the NestJS application
│   ├── modules/          # Feature modules
│   │   ├── auth/         # Authentication and authorization
│   │   ├── users/        # User management
│   │   ├── permissions/  # Permission management
│   │   └── [other modules]/
│   ├── common/           # Common utilities and helpers
│   ├── config/           # Configuration
│   ├── database/         # Database configuration
│   ├── logger/           # Logging services
│   └── shared/           # Shared services and utilities
├── dist/                 # Compiled output (generated)
├── node_modules/         # NPM dependencies (generated)
├── scripts/              # Backend utility scripts
├── test/                 # Integration tests
├── db/                   # Database scripts and schemas
└── logs/                 # Server logs (generated)
```

#### File Types
- **TypeScript (.ts)**: NestJS controllers, services, modules
- **Entity (.entity.ts)**: Database entity definitions
- **DTOs (.dto.ts)**: Data transfer objects
- **Module (.module.ts)**: NestJS modules
- **Spec (.spec.ts)**: Unit and integration tests
- **JSON (.json)**: Configuration files
- **JavaScript (.js)**: Utility scripts

## Technical Architecture

### Frontend Architecture

#### Core Components

1. **Angular Framework**: The application is built using Angular, providing a robust foundation for building single-page applications.

2. **State Management**: NGXS is used for state management, providing a centralized store for application state.

3. **Modular Structure**: The application is organized into feature modules that can be lazy-loaded for improved performance.

4. **Responsive Design**: The UI is designed to be responsive across mobile, tablet, and desktop devices.

5. **Component Architecture**: The application follows a component-based architecture with:
   - Smart components (containers) that manage state
   - Presentational components that focus on UI rendering
   - Shared components for reusable UI elements

6. **Routing**: Angular Router is used for navigation with route guards for access control.

7. **Interceptors**: HTTP interceptors handle authentication, error handling, and logging.

8. **Services**: Services encapsulate business logic and API communication.

For more information about frontend development, see the [Development Guide](DEVELOPMENT.md).

### Backend Architecture

#### Core Components

1. **NestJS Framework**: The backend is built using NestJS, providing a modular and scalable architecture.

2. **Module Structure**: The application is organized into feature modules, each with its own controllers, services, and providers.

3. **TypeORM**: Database access is handled through TypeORM, providing an object-relational mapping layer.

4. **Authentication**: JWT-based authentication with role-based access control.

5. **Middleware**: Custom middleware for logging, error handling, and request validation.

6. **Guards**: Guards protect routes based on authentication and permissions.

7. **Interceptors**: Interceptors handle request/response transformation and logging.

8. **Exception Filters**: Global exception filters provide consistent error handling.

For more information about the API endpoints, see the [API Documentation](API.md).

### Database Architecture

#### Database Design

1. **Entity Relationships**: The database schema is designed with proper relationships between entities.

2. **Migrations**: Database migrations are managed through TypeORM migration scripts.

3. **Indexing**: Proper indexing is implemented for performance optimization.

4. **Constraints**: Foreign key constraints and unique constraints ensure data integrity.

5. **SQLite Development**: SQLite is used for development and testing.

6. **PostgreSQL Production**: PostgreSQL is used for production deployments.

For more information about database management, see the [Database Management section](DEVELOPMENT.md#database-management) in the Development Guide and the detailed [Database Schema Documentation](DATABASE_SCHEMA.md).

#### Key Entities

1. **User**: Represents application users with authentication information.

2. **Role**: Represents user roles with associated permissions.

3. **Permission**: Represents permissions that can be assigned to roles, groups, or users.

4. **Group**: Represents user groups with associated permissions.

5. **Resource**: Represents resources that can be protected by permissions.

6. **Action**: Represents actions that can be performed on resources.

For more information about the permission system, see the [Permissions Documentation](PERMISSIONS.md).

## Security Architecture

### Authentication

1. **JWT Authentication**: JSON Web Tokens are used for stateless authentication.

2. **Token Management**: Tokens are stored in HTTP-only cookies for security.

3. **Refresh Tokens**: Refresh tokens are used to obtain new access tokens without requiring re-authentication.

4. **Password Security**: Passwords are hashed using bcrypt with appropriate salt rounds.

5. **Cookie Management**: A comprehensive cookie consent and management system is implemented as described in the [Cookie Management System section](#cookie-management-system) below.

### Authorization

1. **Permission-Based Access Control**: Access to resources is controlled through permissions.

2. **Role-Based Access Control**: Users are assigned roles with associated permissions.

3. **Group-Based Access Control**: Users can be members of groups with associated permissions.

4. **Route Guards**: Angular route guards protect frontend routes based on permissions.

5. **API Guards**: NestJS guards protect API endpoints based on permissions.

For more information about the permission system, see the [Permissions Documentation](PERMISSIONS.md).

### Data Protection

1. **Input Validation**: All user input is validated using class-validator.

2. **Output Sanitization**: Sensitive data is removed from API responses.

3. **CSRF Protection**: Cross-Site Request Forgery protection is implemented.

4. **XSS Protection**: Cross-Site Scripting protection is implemented through Angular's built-in sanitization.

5. **Rate Limiting**: API endpoints are protected against brute force attacks through rate limiting.

## Performance Optimization

### Frontend Optimization

1. **Lazy Loading**: Feature modules are lazy-loaded to improve initial load time.

2. **AOT Compilation**: Ahead-of-Time compilation is used for production builds.

3. **Tree Shaking**: Unused code is removed during the build process.

4. **Caching**: HTTP responses are cached where appropriate.

5. **Virtual Scrolling**: Large lists use virtual scrolling for improved performance.

### Backend Optimization

1. **Caching**: Responses are cached where appropriate using an in-memory cache.

2. **Database Indexing**: Proper indexing is implemented for database queries.

3. **Query Optimization**: Database queries are optimized for performance.

4. **Connection Pooling**: Database connections are pooled for improved performance.

5. **Compression**: Response compression is enabled for reduced bandwidth usage.

## Deployment Architecture

### Development Environment

1. **Local Development**: Developers run the application locally using npm scripts.

2. **SQLite Database**: SQLite is used for local development.

3. **Hot Reload**: Angular and NestJS both support hot reloading for improved developer experience.

For more information about the development environment, see the [Development Environment Setup section](DEVELOPMENT.md#development-environment-setup) in the Development Guide.

### Production Environment

1. **Docker Containers**: The application is deployed using Docker containers.

2. **PostgreSQL Database**: PostgreSQL is used for production deployments.

3. **Nginx**: Nginx is used as a reverse proxy and for serving static files.

4. **SSL/TLS**: HTTPS is enforced for all communication.

5. **Load Balancing**: Multiple instances of the application can be deployed behind a load balancer.

For more information about deployment, see the [Deployment section](DEVELOPMENT.md#deployment) in the Development Guide.

## Configuration Management

### Environment Configuration

1. **Environment Files**: Angular environment files are used for frontend configuration.

2. **Environment Variables**: NestJS uses environment variables for backend configuration.

3. **Configuration Service**: A configuration service provides access to configuration values.

4. **Secrets Management**: Sensitive configuration values are stored securely.

### Feature Flags

1. **Feature Flag Service**: A service provides access to feature flags.

2. **Dynamic Configuration**: Some configuration values can be changed at runtime.

3. **User-Specific Features**: Features can be enabled/disabled for specific users or roles.

## Logging and Monitoring

### Logging

1. **Frontend Logging**: Angular provides logging through a custom logging service.

2. **Backend Logging**: NestJS uses a custom logger for structured logging.

3. **Log Levels**: Different log levels (debug, info, warn, error) are used for different types of messages.

4. **Log Rotation**: Log files are rotated to prevent excessive disk usage.

For more information about logging, see the [Debugging and Logging section](DEVELOPMENT.md#debugging-and-logging) in the Development Guide.

### Monitoring

1. **Health Checks**: Endpoints are provided for health checks.

2. **Performance Metrics**: Key performance metrics are tracked.

3. **Error Tracking**: Errors are tracked and reported.

4. **User Activity**: User activity is logged for audit purposes.

## Implementation Steps

The implementation of the application follows these high-level steps:

1. **Initial Setup**: Project structure, Git repository, and initial README.

2. **Core Infrastructure**: Database setup, authentication system, logging, and error handling.

3. **User and Group Management**: User CRUD operations, role-based authorization, and group management.

4. **UI Implementation**: Core layout components, responsive design, authentication screens, and navigation.

5. **Integration and Testing**: Connect frontend and backend, write unit tests, and verify security features.

6. **Documentation and Deployment**: Complete user documentation, configure Docker deployment, and prepare for future enhancements.

For more information about testing, see the [Testing section](DEVELOPMENT.md#testing) in the Development Guide.

## Cookie Management System

### Cookie Categories

The application categorizes cookies into four main types:

1. **Necessary Cookies**: Essential for the website to function properly
2. **Preference Cookies**: Allow the website to remember preferences and settings
3. **Analytics Cookies**: Track user behavior to improve site functionality
4. **Marketing Cookies**: Used for targeted advertising and marketing efforts

### Cookie Consent Implementation

The application includes a comprehensive cookie consent system that allows users to control which types of cookies they accept. This consent system is implemented through the `CookieConsentComponent`.

### Cookie Consent Storage

The user's cookie preferences are stored in two ways:

1. **Local Storage**: All cookie preferences are stored in the browser's local storage
2. **User Account (Optional)**: Cookie preferences can be associated with a user account

### Service Implementation

To manage cookies consistently across the application, a dedicated cookie service is provided:

```typescript
// src/app/core/services/cookie.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface CookieSettings {
  necessary: boolean;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class CookieService {
  private readonly COOKIE_CONSENT_KEY = 'cookie-consent-settings';
  private cookieSettingsSubject = new BehaviorSubject<CookieSettings>({
    necessary: true,
    preferences: false,
    analytics: false,
    marketing: false
  });

  cookieSettings$ = this.cookieSettingsSubject.asObservable();

  constructor() {
    this.loadSettings();
  }

  private loadSettings(): void {
    const storedSettings = localStorage.getItem(this.COOKIE_CONSENT_KEY);
    if (storedSettings) {
      try {
        const parsed = JSON.parse(storedSettings);
        this.cookieSettingsSubject.next(parsed.settings);
      } catch (e) {
        console.error('Failed to parse cookie settings', e);
      }
    }
  }

  getSettings(): CookieSettings {
    return this.cookieSettingsSubject.value;
  }

  isCategoryAccepted(category: keyof CookieSettings): boolean {
    return this.cookieSettingsSubject.value[category];
  }

  setCookie(name: string, value: string, days: number, category: keyof CookieSettings): boolean {
    // Always set necessary cookies
    if (category === 'necessary') {
      this.setRawCookie(name, value, days);
      return true;
    }

    // Only set other cookies if the category is accepted
    if (this.isCategoryAccepted(category)) {
      this.setRawCookie(name, value, days);
      return true;
    }

    return false;
  }

  private setRawCookie(name: string, value: string, days: number): void {
    let expires = '';
    if (days) {
      const date = new Date();
      date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
      expires = '; expires=' + date.toUTCString();
    }
    document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/; SameSite=Lax';
  }

  getCookie(name: string): string | null {
    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') {
        c = c.substring(1, c.length);
      }
      if (c.indexOf(nameEQ) === 0) {
        return decodeURIComponent(c.substring(nameEQ.length, c.length));
      }
    }
    return null;
  }

  deleteCookie(name: string): void {
    document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
  }
}
```

### Best Practices

1. **Transparency**: Clearly communicate what cookies are being used and why
2. **Defaults**: Set conservative defaults (only necessary cookies enabled)
3. **Consistency**: Use the cookie service throughout the application
4. **Respect User Choices**: Always respect the user's cookie preferences
5. **Documentation**: Keep documentation updated with any new cookies used in the application

### Legal Compliance

Ensure your cookie implementation complies with relevant regulations:

- **GDPR**: Requires explicit consent for non-essential cookies in the EU
- **CCPA**: Provides California residents with the right to opt-out of cookie tracking
- **ePrivacy Directive**: Requires informed consent before storing cookies

## Access Control Migration

### Overview

The application has successfully migrated from hardcoded access control mechanisms to a fully dynamic, database-driven permission system with hierarchical roles and groups. This section outlines the migration process and implementation details.

### Audit Process

An automated scan identified multiple instances of hardcoded access control throughout the codebase:

#### Backend Findings

```
# Hardcoded role strings
Found 23 instances in 14 files

# Role type definitions
Found role enum in role.entity.ts line 8

# Hardcoded role checks in guards and controllers
Found 37 instances in 19 files

# Seed data with hardcoded roles
Found 12 instances in 3 files
```

#### Frontend Findings

```
# Hardcoded role strings
Found 42 instances in 28 files

# Role-based route configurations
Found 15 instances in 3 files

# Role-based conditional displays
Found 53 instances in 31 files

# Role checks in components and services
Found 29 instances in 16 files
```

### Migration Strategy

#### Database Schema Updates

The following schema changes were implemented:

1. Modified the roles table to add parent-child relationships
2. Created comprehensive permission tables (permissions, role_permissions, etc.)
3. Updated groups table to support hierarchical structure
4. Added new tables for dynamic UI components, routes, and API endpoints:
   - ui_components
   - ui_component_permissions
   - frontend_routes
   - route_permissions
   - api_endpoints
   - endpoint_permissions
   - permission_sync_status

#### Backend Implementation

1. **Entity Models**: All models updated to support the new permission system
2. **Permission Services**: Comprehensive set of services implemented for permission management
3. **Permission Resolution**: Hierarchical permission resolution system implemented
4. **Guards and Decorators**: Updated to use the permission system
5. **Registration System**: Added auto-registration for components, routes, and endpoints

#### Frontend Implementation

1. **Core Services**: Implemented enhanced permission service
2. **Directives**: Created HasPermissionDirective for UI control
3. **Route Guards**: Implemented PermissionGuard for route protection
4. **Component Updates**: All components updated to use permission system
5. **Management Interface**: Created admin UI for permission management

### Advanced Components

#### Code-First Approach with Auto-Registration

A code-first approach was implemented with decorators for registration:

```typescript
// Component Registration
@RegisterPermissionComponent({
  id: 'create_user_btn',
  description: 'Create User Button',
  requiredPermissions: ['users:create']
})
@Component({...})
export class UserCreateButtonComponent {}

// Route Registration (in route definitions)
const routes: Routes = [
  {
    path: 'admin/users',
    component: UserManagementComponent,
    data: {
      permissionId: 'admin_users_route',
      description: 'User Management Page',
      requiredPermissions: ['users:manage']
    }
  }
];

// API Endpoint Registration
@Controller('users')
export class UsersController {
  @Get()
  @RegisterEndpoint({
    id: 'list_users_endpoint',
    description: 'List all users',
    requiredPermissions: ['users:list']
  })
  listUsers() {
    // Implementation
  }
}
```

#### Synchronization Process

A robust synchronization process was implemented:

1. **Build-time Registration Scanner**:
   - Code scanners process decorators and metadata
   - Manifest generator creates a comprehensive listing
   - Tracking system identifies changes between scans

2. **Database Synchronization Tool**:
   - Comparison between manifest and database
   - Smart updates to preserve customizations
   - Alert system for missing or inconsistent permissions

3. **SQLite Cache Database**:
   - Local cache for improved performance
   - Periodic synchronization with main database
   - Transaction-based updates for consistency

#### Smart Defaults and Inheritance

The system implements intelligent defaults and inheritance:

1. **Naming Conventions**:
   - Component names map to permissions
   - Controller methods map to endpoint permissions
   - Route paths map to route permissions

2. **Hierarchical Inheritance**:
   - Component hierarchies for permission inheritance
   - Nested routes inherit parent permissions
   - Controller-level permissions cascade to methods

### Admin Interface

A comprehensive admin interface was developed:

1. **Permission Dashboard Card**:
   - Real-time permission status
   - Alerts for inconsistencies
   - Manual synchronization triggers
   - Detailed reports

2. **Component Management**:
   - List all registered components
   - Edit component permissions
   - Override default permissions
   - Test component visibility

3. **Route Management**:
   - View route hierarchy
   - Edit route permissions
   - Test route access
   - Route access simulation

4. **API Endpoint Management**:
   - View all registered endpoints
   - Edit endpoint permissions
   - Test endpoint access
   - Endpoint permission hierarchy

### Results and Benefits

The migration to a fully dynamic permission system has delivered significant benefits:

1. **Enhanced Security**:
   - Removal of all hardcoded role checks
   - Fine-grained permission control
   - Auditable permission changes
   - Comprehensive permission logging

2. **Improved Flexibility**:
   - Runtime permission changes without deployment
   - Role and group hierarchies for inheritance
   - Custom permission rules and policies
   - Environment-specific permissions

3. **Performance Optimization**:
   - Efficient caching mechanisms
   - Reduced database queries
   - Optimized permission resolution
   - Scalable for large applications

4. **Simplified Administration**:
   - Centralized permission management
   - Intuitive admin interface
   - Automatic permission discovery
   - Comprehensive reporting

For more information about the permission system, see the [Permissions Documentation](PERMISSIONS.md).
