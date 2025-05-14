# Architecture Documentation

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

### Database Architecture

#### Database Design

1. **Entity Relationships**: The database schema is designed with proper relationships between entities.

2. **Migrations**: Database migrations are managed through TypeORM migration scripts.

3. **Indexing**: Proper indexing is implemented for performance optimization.

4. **Constraints**: Foreign key constraints and unique constraints ensure data integrity.

5. **SQLite Development**: SQLite is used for development and testing.

6. **PostgreSQL Production**: PostgreSQL is used for production deployments.

#### Key Entities

1. **User**: Represents application users with authentication information.

2. **Role**: Represents user roles with associated permissions.

3. **Permission**: Represents permissions that can be assigned to roles, groups, or users.

4. **Group**: Represents user groups with associated permissions.

5. **Resource**: Represents resources that can be protected by permissions.

6. **Action**: Represents actions that can be performed on resources.

## Security Architecture

### Authentication

1. **JWT Authentication**: JSON Web Tokens are used for stateless authentication.

2. **Token Management**: Tokens are stored in HTTP-only cookies for security.

3. **Refresh Tokens**: Refresh tokens are used to obtain new access tokens without requiring re-authentication.

4. **Password Security**: Passwords are hashed using bcrypt with appropriate salt rounds.

### Authorization

1. **Permission-Based Access Control**: Access to resources is controlled through permissions.

2. **Role-Based Access Control**: Users are assigned roles with associated permissions.

3. **Group-Based Access Control**: Users can be members of groups with associated permissions.

4. **Route Guards**: Angular route guards protect frontend routes based on permissions.

5. **API Guards**: NestJS guards protect API endpoints based on permissions.

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

### Production Environment

1. **Docker Containers**: The application is deployed using Docker containers.

2. **PostgreSQL Database**: PostgreSQL is used for production deployments.

3. **Nginx**: Nginx is used as a reverse proxy and for serving static files.

4. **SSL/TLS**: HTTPS is enforced for all communication.

5. **Load Balancing**: Multiple instances of the application can be deployed behind a load balancer.

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
