import { Injectable } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor,
  HttpErrorResponse
} from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, filter, switchMap, take, finalize } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private isRefreshing = false;
  private refreshTokenSubject: BehaviorSubject<any> = new BehaviorSubject<any>(null);

  constructor(private authService: AuthService) {}

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Skip interceptor for auth endpoints (except profile)
    if (this.isAuthRequest(request) && !request.url.includes('/profile')) {
      return next.handle(request);
    }

    // Add auth header if user is authenticated
    if (this.authService.accessToken) {
      request = this.addAuthHeader(request, this.authService.accessToken);
    }

    // Add CSRF token if available
    if (this.authService.csrfToken) {
      request = this.addCsrfHeader(request, this.authService.csrfToken);
    }

    return next.handle(request).pipe(
      catchError(error => {
        if (error instanceof HttpErrorResponse && error.status === 401) {
          return this.handle401Error(request, next);
        }
        return throwError(() => error);
      })
    );
  }

  private isAuthRequest(request: HttpRequest<any>): boolean {
    const apiUrl = this.authService['API_URL']; // Accessing the API_URL from AuthService
    return request.url.includes(`${apiUrl}/login`) || 
           request.url.includes(`${apiUrl}/register`) || 
           request.url.includes(`${apiUrl}/refresh`) || 
           request.url.includes(`${apiUrl}/forgot-password`) || 
           request.url.includes(`${apiUrl}/reset-password`);
  }

  private addAuthHeader(request: HttpRequest<any>, token: string): HttpRequest<any> {
    return request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  private addCsrfHeader(request: HttpRequest<any>, token: string): HttpRequest<any> {
    return request.clone({
      setHeaders: {
        'X-CSRF-Token': token
      }
    });
  }

  private handle401Error(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshTokenSubject.next(null);

      return this.authService.refreshAccessToken().pipe(
        switchMap(response => {
          this.refreshTokenSubject.next(response.accessToken);
          return next.handle(this.addAuthHeader(request, response.accessToken));
        }),
        catchError(error => {
          // Force logout on refresh error
          this.authService.logout();
          return throwError(() => error);
        }),
        finalize(() => {
          this.isRefreshing = false;
        })
      );
    }

    return this.refreshTokenSubject.pipe(
      filter(token => token !== null),
      take(1),
      switchMap(token => next.handle(this.addAuthHeader(request, token)))
    );
  }
} 