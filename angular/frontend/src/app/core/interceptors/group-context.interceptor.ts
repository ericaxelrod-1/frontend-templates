import { Injectable } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Interceptor that adds the X-Active-Group-Id header to write requests
 * based on the user's currently selected active group.
 */
@Injectable()
export class GroupContextInterceptor implements HttpInterceptor {
  constructor(private authService: AuthService) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const activeGroupId = this.authService.getActiveGroupId();
    const isWriteOperation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method.toUpperCase());

    if (activeGroupId && isWriteOperation) {
      const cloned = request.clone({
        setHeaders: {
          'X-Active-Group-Id': activeGroupId.toString()
        }
      });
      return next.handle(cloned);
    }

    return next.handle(request);
  }
}
