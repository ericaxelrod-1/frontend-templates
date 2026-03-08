import { Injectable, NestMiddleware } from '@nestjs/common';
import { LoggerService } from './logger.service';

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  constructor(private readonly logger: LoggerService) { }

  use(request: any, response: any, next: () => void): void {
    const method = request.method;
    const originalUrl = request.url || request.originalUrl;
    const ip = request.ip || request.socket?.remoteAddress || '';
    const userAgent = request.headers['user-agent'] || '';

    // Log the incoming request
    this.logger.debug(
      `${method} ${originalUrl} - ${ip} - ${userAgent}`,
      'HTTP',
    );

    // Track timing
    const start = Date.now();

    response.on('finish', () => {
      const statusCode = response.statusCode;
      const contentLength = response.getHeader ? response.getHeader('content-length') : 0;
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
