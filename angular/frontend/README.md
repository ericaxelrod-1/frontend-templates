# Angular Template Application

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
cd angular-template/frontend

# Install dependencies
npm install
```

### Development Server

```bash
# Start the development server
npm start
```

Navigate to `http://localhost:4200/` to view the application.

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
