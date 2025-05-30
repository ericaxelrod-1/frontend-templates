import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggerService } from './logger.service';

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  constructor(private readonly logger: LoggerService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const { method, originalUrl, ip } = request;
    const userAgent = request.get('user-agent') || '';

    // Log the incoming request
    this.logger.debug(
      `${method} ${originalUrl} - ${ip} - ${userAgent}`,
      'HTTP',
    );

    // Track timing
    const start = Date.now();

    response.on('finish', () => {
      const { statusCode } = response;
      const contentLength = response.get('content-length');
      const duration = Date.now() - start;

      // Log based on status code
      const message = `${method} ${originalUrl} ${statusCode} ${contentLength}b - ${duration}ms`;

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
