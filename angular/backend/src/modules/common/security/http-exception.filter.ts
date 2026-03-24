import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { LoggerService } from '../../../logger/logger.service';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const status = exception.getStatus();

    // Get the exception response
    const exceptionResponse = exception.getResponse();

    // Create a sanitized response object (don't expose internal server details in production)
    const errorResponse = {
      statusCode: status,
      message: this.getErrorMessage(exceptionResponse),
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(process.env.NODE_ENV !== 'production' && {
        details: exceptionResponse,
      }),
    };

    // Log the error with appropriate level
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} ${status} - ${JSON.stringify(errorResponse)}`,
        exception.stack,
        'HttpExceptionFilter',
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} ${status} - ${JSON.stringify(errorResponse)}`,
        'HttpExceptionFilter',
      );
    }

    // Send the response
    response.status(status).send(errorResponse);
  }

  private getErrorMessage(exceptionResponse: any): string {
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      // Handle class-validator errors
      if (Array.isArray(exceptionResponse.message)) {
        return exceptionResponse.message[0];
      }

      // Use provided message or fallback
      return exceptionResponse.message || 'An error occurred';
    }

    return 'An error occurred';
  }
}
