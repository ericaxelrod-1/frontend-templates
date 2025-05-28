# Task Management Backend

## Description
Backend API for the Task Management System built with NestJS.

## Features

- User authentication with JWT
- Task management with categories and tags
- RESTful API endpoints
- Data persistence with SQLite
- Input validation
- CORS support
- IP allowlist for trusted IP addresses
- Advanced security features with IP reputation tracking

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn

## Installation
```bash
cd angular/backend  # Important: Make sure you're in the backend directory
npm install
```

## Running the app

### Development mode
```bash
cd angular/backend  # Important: Make sure you're in the backend directory
npm run start:dev
```

### Debug mode
Windows (PowerShell):
```powershell
cd angular/backend  # Important: Make sure you're in the backend directory
$env:DEBUG='true'; npm run start:dev
```

Windows (CMD):
```cmd
cd angular/backend
set DEBUG=true && npm run start:dev
```

Unix/Linux/MacOS:
```bash
cd angular/backend
DEBUG=true npm run start:dev
```

### Production mode
```bash
cd angular/backend
npm run start:prod
```

## IP Allowlist Configuration

The application supports an IP allowlist feature that lets trusted IP addresses bypass security restrictions. To configure:

### Environment Variables

Add these to your `.env` file:

```
# Comma-separated list of allowlisted IPs
IP_ALLOWLIST=192.168.1.100,10.0.0.1

# Enable debug logging to see allowlist decisions
DEBUG_MODE=true
LOG_TO_FILE=true
```

### Testing IP Allowlist

Run the IP allowlist tests to verify functionality:

```bash
cd angular/backend
npm run test:ip-allowlist         # Basic allowlist tests
npm run test:ip-allowlist:detailed # Detailed middleware tests
```

### Documentation

For detailed documentation on the IP allowlist feature, see the [IP Allowlist Guide](../docs/ip-allowlist-guide.md).

## Debugging

### Node.js Debugger
To use the Node.js debugger:

1. Start the server in debug mode (as shown above)
2. Open Chrome and navigate to `chrome://inspect`
3. Click on "Open dedicated DevTools for Node"
4. The debugger will connect to port 9229 automatically
5. You can now set breakpoints and debug your code

### API Documentation
Once the application is running:
1. Open your browser to http://localhost:3000/api
2. You'll see the Swagger documentation interface
3. All available endpoints are documented and can be tested directly from the browser

## Test

### Unit Tests
```bash
cd angular/backend
npm run test
```

### E2E Tests
```bash
cd angular/backend
npm run test:e2e
```

### Test Coverage
```bash
cd angular/backend
npm run test:cov
```

## Logging

The application uses a custom logging system with the following log files:

- `logs/app.log`: General application logs
- `logs/error.log`: Error logs only
- `logs/debug.log`: Debug logs (only when DEBUG=true)
- `logs/audit.log`: Audit logs

### Log Rotation
- Logs are automatically rotated every 7 days
- Old log files are automatically deleted

### Debug Mode
Debug mode enables additional logging and creates a separate debug.log file. To enable debug mode:

1. Set the DEBUG environment variable to 'true' using one of the methods above
2. Or add DEBUG=true to your .env file

Example .env configuration:
```env
PORT=3000
DEBUG=true
FRONTEND_URL=http://localhost:4200
DATABASE_FILE=db.sqlite
```

### Debugging Tips
1. Always ensure you're in the correct directory (angular/backend)
2. Check the logs directory for detailed error messages
3. Use the Swagger UI at http://localhost:3000/api for API testing
4. Use Chrome DevTools for Node.js debugging at chrome://inspect
5. Set breakpoints in your IDE by connecting to port 9229

## API Documentation
Once the application is running, you can access the Swagger API documentation at:
```
http://localhost:3000/api
```

## Directory Structure
```
angular/backend/
├── src/                    # Source code
├── test/                   # Test files
├── logs/                   # Log files (git-ignored)
├── dist/                   # Compiled output
├── node_modules/          # Dependencies
├── .env                   # Environment variables
└── package.json           # Project configuration
```

## API Endpoints

### Authentication
- `