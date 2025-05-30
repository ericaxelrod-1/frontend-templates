# Angular Application with Dynamic Permissions

This is a modern Angular application with a NestJS backend that features a comprehensive, fully dynamic database-driven access control system.

## Key Features

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

```
angular/
├── frontend/          # Angular frontend application
├── backend/           # NestJS backend application
└── docs/              # Project documentation
```

## Getting Started

### Prerequisites

- Node.js (v14+)
- npm or yarn
- PostgreSQL database

### Backend Setup

```bash
cd backend
npm install
npm run migration:run
npm run start:dev
```

### Frontend Setup

```bash
cd frontend
npm install
npm start
```

The application will be available at `http://localhost:4200` with the API running at `http://localhost:3000`.

## Development

### Running Tests

```bash
# Backend tests
cd backend
npm run test

# Frontend tests
cd frontend
npm run test

# Test specific files (e.g., a directive)
cd frontend
npm test -- --include=src/app/shared/directives/has-permission.directive.spec.ts
```

### Building for Production

```bash
# Build backend
cd backend
npm run build

# Build frontend
cd frontend
npm run build
```

## Documentation

- [Permissions System](PERMISSIONS.md)
- [Architecture](ARCHITECTURE.md)
- [Development Guide](DEVELOPMENT.md)
- [API Documentation](API.md)

## License

This project is licensed under the MIT License - see the LICENSE file for details.
