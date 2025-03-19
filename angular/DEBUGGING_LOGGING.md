# Angular Template Application - Debugging and Logging Guidelines

## Debugging Configuration

### Debug Mode

The application supports a debug mode that can be enabled via:

1. Command-line argument for backend services:
   ```bash
   node app.js --debug
   ```

2. Environment variable:
   ```bash
   DEBUG=true node app.js
   ```

3. Configuration file:
   ```json
   {
     "debug": true
   }
   ```

### Debug Levels

The application uses the following debug levels:

- **ERROR**: Critical errors that prevent the application from functioning
- **WARN**: Issues that don't stop the application but require attention
- **INFO**: General information about application flow
- **DEBUG**: Detailed information for debugging purposes
- **TRACE**: Extremely detailed information (method entry/exit, variables)

## Logging System Architecture

### Backend Logging (NestJS)

#### Logger Service

```typescript
// logger/logger.service.ts
import { Injectable, LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import * as DailyRotateFile from 'winston-daily-rotate-file';

@Injectable()
export class LoggerService {
  private logger: winston.Logger;
  
  constructor(private configService: ConfigService) {
    const debugMode = this.configService.get<boolean>('debug') || false;
    const logLevel = debugMode ? 'debug' : 'info';
    
    const logFormat = winston.format.combine(
      winston.format.timestamp({
        format: 'YYYYMMDD HHmmss'
      }),
      winston.format.printf(
        (info) => `${info.timestamp} ${info.level}: ${info.message}`
      )
    );
    
    const transport = new DailyRotateFile({
      filename: 'application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '7d'
    });
    
    this.logger = winston.createLogger({
      level: logLevel,
      format: logFormat,
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            logFormat
          )
        }),
        transport
      ]
    });
  }
  
  log(message: string, context?: string) {
    this.logger.info(this.formatMessage(message, context));
  }
  
  error(message: string, trace?: string, context?: string) {
    this.logger.error(this.formatMessage(message, context));
    if (trace) {
      this.logger.error(trace);
    }
  }
  
  warn(message: string, context?: string) {
    this.logger.warn(this.formatMessage(message, context));
  }
  
  debug(message: string, context?: string) {
    this.logger.debug(this.formatMessage(message, context));
  }
  
  verbose(message: string, context?: string) {
    this.logger.verbose(this.formatMessage(message, context));
  }
  
  private formatMessage(message: string, context?: string): string {
    return context ? `[${context}] ${message}` : message;
  }
}
```

#### Logger Module

```typescript
// logger/logger.module.ts
import { Module, Global } from '@nestjs/common';
import { LoggerService } from './logger.service';

@Global()
@Module({
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
```

#### Application Module Integration

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from './logger/logger.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    LoggerModule,
  ],
})
export class AppModule {}
```

### Frontend Logging (Angular)

#### Logger Service

```typescript
// core/services/logger.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';

export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG',
  TRACE = 'TRACE',
}

@Injectable({
  providedIn: 'root'
})
export class LoggerService {
  private debug: boolean = environment.debug;
  private logEndpoint: string = `${environment.apiUrl}/logs`;
  private logBuffer: any[] = [];
  private bufferSize: number = 10;
  private flushInterval: number = 10000; // 10 seconds
  
  constructor(private http: HttpClient) {
    setInterval(() => this.flushLogs(), this.flushInterval);
    window.addEventListener('beforeunload', () => this.flushLogs());
  }
  
  error(message: string, error?: any, context?: string): void {
    this.logToConsole(LogLevel.ERROR, message, error, context);
    this.addToBuffer(LogLevel.ERROR, message, error, context);
  }
  
  warn(message: string, context?: string): void {
    this.logToConsole(LogLevel.WARN, message, null, context);
    this.addToBuffer(LogLevel.WARN, message, null, context);
  }
  
  info(message: string, context?: string): void {
    this.logToConsole(LogLevel.INFO, message, null, context);
    this.addToBuffer(LogLevel.INFO, message, null, context);
  }
  
  debug(message: string, context?: string): void {
    if (this.debug) {
      this.logToConsole(LogLevel.DEBUG, message, null, context);
      this.addToBuffer(LogLevel.DEBUG, message, null, context);
    }
  }
  
  trace(message: string, context?: string): void {
    if (this.debug) {
      this.logToConsole(LogLevel.TRACE, message, null, context);
      this.addToBuffer(LogLevel.TRACE, message, null, context);
    }
  }
  
  private logToConsole(level: LogLevel, message: string, error?: any, context?: string): void {
    const formattedMessage = context ? `[${context}] ${message}` : message;
    
    switch (level) {
      case LogLevel.ERROR:
        console.error(formattedMessage, error || '');
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage);
        break;
      case LogLevel.INFO:
        console.info(formattedMessage);
        break;
      case LogLevel.DEBUG:
        console.debug(formattedMessage);
        break;
      case LogLevel.TRACE:
        console.trace(formattedMessage);
        break;
    }
  }
  
  private addToBuffer(level: LogLevel, message: string, error?: any, context?: string): void {
    const timestamp = this.getFormattedTimestamp();
    
    this.logBuffer.push({
      timestamp,
      level,
      message,
      error: error ? this.serializeError(error) : null,
      context,
      userAgent: navigator.userAgent,
      url: window.location.href
    });
    
    if (this.logBuffer.length >= this.bufferSize) {
      this.flushLogs();
    }
  }
  
  private flushLogs(): void {
    if (this.logBuffer.length === 0) return;
    
    const logs = [...this.logBuffer];
    this.logBuffer = [];
    
    this.http.post(this.logEndpoint, { logs }).subscribe({
      error: (err) => {
        console.error('Failed to send logs to server', err);
        // If sending fails, add the logs back to the buffer
        this.logBuffer = [...logs, ...this.logBuffer];
        if (this.logBuffer.length > this.bufferSize * 2) {
          // Prevent buffer from growing too large
          this.logBuffer = this.logBuffer.slice(-this.bufferSize);
        }
      }
    });
  }
  
  private getFormattedTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `${year}${month}${day} ${hours}${minutes}${seconds}`;
  }
  
  private serializeError(error: any): any {
    if (!error) return null;
    
    const serialized: any = {
      message: error.message || '',
      name: error.name || '',
      stack: error.stack || '',
    };
    
    if (error.status) serialized.status = error.status;
    if (error.statusText) serialized.statusText = error.statusText;
    
    return serialized;
  }
}
```

#### Error Interceptor

```typescript
// core/interceptors/error.interceptor.ts
import { Injectable } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor,
  HttpErrorResponse
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { LoggerService } from '../services/logger.service';

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
  constructor(private logger: LoggerService) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(request).pipe(
      catchError((error: HttpErrorResponse) => {
        const errorMessage = this.getErrorMessage(error);
        this.logger.error(`HTTP Error: ${errorMessage}`, error, 'HttpInterceptor');
        return throwError(() => error);
      })
    );
  }

  private getErrorMessage(error: HttpErrorResponse): string {
    if (error.error instanceof ErrorEvent) {
      // Client-side error
      return `Client error: ${error.error.message}`;
    } else {
      // Server-side error
      return `Server error: ${error.status} - ${error.message}`;
    }
  }
}
```

## Log File Management

### Log File Naming

Log files follow a standardized naming pattern:
- `application-YYYY-MM-DD.log` - General application logs
- `error-YYYY-MM-DD.log` - Error-specific logs
- `access-YYYY-MM-DD.log` - HTTP access logs

### Log Rotation

The application uses a 7-day log rotation policy:

1. Each log file is named with the current date
2. Log files older than 7 days are automatically deleted
3. Large log files are split when they exceed 20MB

### Log Output Format

All logs follow a standardized format:

```
YYYYMMDD HHmmss [LEVEL] [CONTEXT]: MESSAGE
```

Example:
```
20230615 143227 [INFO] [UserService]: User logged in successfully (userId: 123)
20230615 143228 [ERROR] [AuthGuard]: Invalid token provided
```

## Debugging Tools and Techniques

### Backend Debugging

#### NestJS Debugging

1. **Local Debugging with VS Code**

   Configure `.vscode/launch.json`:
   ```json
   {
     "version": "0.2.0",
     "configurations": [
       {
         "type": "node",
         "request": "launch",
         "name": "Debug NestJS",
         "runtimeExecutable": "npm",
         "runtimeArgs": ["run", "start:debug"],
         "sourceMaps": true,
         "envFile": "${workspaceFolder}/.env",
         "cwd": "${workspaceRoot}",
         "console": "integratedTerminal"
       }
     ]
   }
   ```

2. **Remote Debugging**

   Add to `package.json`:
   ```json
   {
     "scripts": {
       "start:debug": "nest start --debug=0.0.0.0:9229"
     }
   }
   ```

#### Middleware for Request/Response Logging

```typescript
// middleware/logger.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggerService } from '../logger/logger.service';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  constructor(private readonly logger: LoggerService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || '';
    
    const startTime = Date.now();
    
    this.logger.debug(
      `REQUEST: ${method} ${originalUrl} - ${ip} - ${userAgent}`,
      'HTTP'
    );
    
    res.on('finish', () => {
      const { statusCode } = res;
      const contentLength = res.get('content-length') || 0;
      const responseTime = Date.now() - startTime;
      
      const message = `RESPONSE: ${method} ${originalUrl} ${statusCode} ${contentLength} - ${responseTime}ms`;
      
      if (statusCode >= 500) {
        this.logger.error(message, '', 'HTTP');
      } else if (statusCode >= 400) {
        this.logger.warn(message, 'HTTP');
      } else {
        this.logger.debug(message, 'HTTP');
      }
    });
    
    next();
  }
}
```

### Frontend Debugging

#### Angular DevTools

1. Install the Angular DevTools Chrome extension
2. Use the Component Tree explorer to debug component hierarchy and state
3. Use the Profiler to identify performance bottlenecks

#### Augury Chrome Extension

For debugging Angular component relationships and data flow.

#### Debug Configuration in Environment

```typescript
// environments/environment.ts
export const environment = {
  production: false,
  debug: true,
  apiUrl: 'http://localhost:3000/api',
  logLevel: 'debug'
};

// environments/environment.prod.ts
export const environment = {
  production: true,
  debug: false,
  apiUrl: '/api',
  logLevel: 'error'
};
```

#### Debug Component

```typescript
// shared/components/debug/debug.component.ts
import { Component, Input, OnInit } from '@angular/core';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-debug',
  template: `
    <div *ngIf="isDebugMode" class="debug-panel">
      <div class="debug-header">Debug Information</div>
      <pre>{{ data | json }}</pre>
    </div>
  `,
  styles: [`
    .debug-panel {
      position: fixed;
      bottom: 0;
      right: 0;
      background-color: rgba(0, 0, 0, 0.8);
      color: #fff;
      padding: 10px;
      max-width: 300px;
      max-height: 400px;
      overflow: auto;
      z-index: 9999;
      border-top-left-radius: 5px;
    }
    .debug-header {
      font-weight: bold;
      padding-bottom: 5px;
      border-bottom: 1px solid #555;
      margin-bottom: 5px;
    }
  `]
})
export class DebugComponent implements OnInit {
  @Input() data: any;
  isDebugMode = false;

  ngOnInit(): void {
    this.isDebugMode = environment.debug;
  }
}
```

Usage:
```html
<app-debug [data]="{ user: currentUser, permissions: userPermissions }"></app-debug>
```

## Error Handling Best Practices

### Backend Error Handling

#### Global Exception Filter

```typescript
// filters/http-exception.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LoggerService } from '../logger/logger.service';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private logger: LoggerService) {}

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    
    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: exception.message || 'Internal server error',
    };
    
    // Log the error
    const errorMsg = `${request.method} ${request.url} ${status}`;
    this.logger.error(
      errorMsg,
      exception.stack,
      'ExceptionFilter'
    );
    
    response
      .status(status)
      .json(errorResponse);
  }
}
```

#### Controller-level Error Handling

```typescript
// users/users.controller.ts
import { Controller, Get, Param, UseFilters } from '@nestjs/common';
import { UsersService } from './users.service';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { LoggerService } from '../logger/logger.service';

@Controller('users')
@UseFilters(HttpExceptionFilter)
export class UsersController {
  constructor(
    private usersService: UsersService,
    private logger: LoggerService
  ) {}

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      this.logger.debug(`Getting user with ID: ${id}`, 'UsersController');
      return await this.usersService.findOne(id);
    } catch (error) {
      this.logger.error(`Error getting user with ID: ${id}`, error, 'UsersController');
      throw error;
    }
  }
}
```

### Frontend Error Handling

#### Global Error Handler

```typescript
// core/handlers/global-error.handler.ts
import { ErrorHandler, Injectable, NgZone } from '@angular/core';
import { LoggerService } from '../services/logger.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  constructor(
    private logger: LoggerService,
    private snackBar: MatSnackBar,
    private zone: NgZone
  ) {}

  handleError(error: any): void {
    // Log the error
    this.logger.error('Unhandled Error', error, 'GlobalErrorHandler');
    
    // Show a user-friendly error message
    this.zone.run(() => {
      this.snackBar.open(
        'An unexpected error has occurred. Please try again later.',
        'Close',
        { duration: 5000 }
      );
    });
    
    // For development mode, throw the error to the console
    console.error('Error from global error handler', error);
  }
}
```

#### Component-level Error Handling

```typescript
// users/user-profile/user-profile.component.ts
import { Component, OnInit } from '@angular/core';
import { UserService } from '../../services/user.service';
import { LoggerService } from '../../core/services/logger.service';
import { catchError, finalize } from 'rxjs/operators';
import { throwError } from 'rxjs';

@Component({
  selector: 'app-user-profile',
  templateUrl: './user-profile.component.html',
  styleUrls: ['./user-profile.component.scss']
})
export class UserProfileComponent implements OnInit {
  user: any = null;
  loading = false;
  error = null;

  constructor(
    private userService: UserService,
    private logger: LoggerService
  ) {}

  ngOnInit(): void {
    this.loadUserProfile();
  }

  loadUserProfile(): void {
    this.loading = true;
    this.error = null;
    
    this.logger.debug('Loading user profile', 'UserProfileComponent');
    
    this.userService.getCurrentUser()
      .pipe(
        catchError(err => {
          this.error = 'Failed to load user profile';
          this.logger.error('Error loading user profile', err, 'UserProfileComponent');
          return throwError(() => err);
        }),
        finalize(() => {
          this.loading = false;
        })
      )
      .subscribe(user => {
        this.user = user;
        this.logger.debug('User profile loaded successfully', 'UserProfileComponent');
      });
  }
}
```

## Best Practices for Debugging and Logging

1. **Always use structured logging**
   - Include timestamp, log level, context, and message in every log
   - Use consistent log format across the application

2. **Log meaningful information**
   - Include identifiers (user ID, session ID, request ID)
   - Include contextual information (component, method)
   - For errors, include stack traces and related data

3. **Use appropriate log levels**
   - ERROR: Use for unrecoverable errors that require intervention
   - WARN: Use for recoverable issues that may indicate problems
   - INFO: Use for significant events in the application flow
   - DEBUG: Use for detailed information useful during development
   - TRACE: Use for extremely detailed debugging information

4. **Balance logging verbosity**
   - Too little logging makes debugging difficult
   - Too much logging impacts performance and clarity
   - Use debug mode to control verbosity

5. **Centralize error handling**
   - Use global exception handlers/filters
   - Standardize error responses
   - Ensure all errors are logged

6. **Protect sensitive information**
   - Never log passwords, tokens, or personal information
   - Mask sensitive data in logs (e.g., "password": "[REDACTED]")

7. **Implement log rotation**
   - Prevent log files from growing too large
   - Automatically archive/delete old logs

8. **Use correlation IDs for distributed tracing**
   - Generate a unique ID for each request
   - Pass the ID through all services and components
   - Include the ID in all related log entries

9. **Enable debugging selectively**
   - Use feature flags to enable debugging for specific components
   - Allow dynamic adjustment of log levels

10. **Monitor and analyze logs**
    - Implement log aggregation and searching
    - Set up alerts for critical errors
    - Regularly review logs for patterns and issues 