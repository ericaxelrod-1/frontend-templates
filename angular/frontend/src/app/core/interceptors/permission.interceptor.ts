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
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Interceptor that handles permission-related HTTP errors.
 * Redirects to appropriate pages based on the error status.
 */
@Injectable()
export class PermissionInterceptor implements HttpInterceptor {
  constructor(
    private router: Router,
    private authService: AuthService
  ) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(request).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401) {
          // Unauthorized - User is not logged in or token expired
          this.authService.logout();
          this.router.navigate(['/auth/login'], {
            queryParams: { returnUrl: this.router.url }
          });
        } else if (error.status === 403) {
          // Forbidden - User doesn't have permission
          this.router.navigate(['/access-denied']);
        }
        
        return throwError(() => error);
      })
    );
  }
} 