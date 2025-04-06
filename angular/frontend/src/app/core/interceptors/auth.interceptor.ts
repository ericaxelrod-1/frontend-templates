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
import { Router } from '@angular/router';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private isRefreshing = false;
  private refreshTokenSubject: BehaviorSubject<any> = new BehaviorSubject<any>(null);

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Log request details in development
    console.log(`Intercepting request to: ${request.url}`);
    
    // Skip interceptor for auth endpoints (except profile)
    if (this.isAuthRequest(request) && !request.url.includes('/profile')) {
      console.log('Skipping auth header for auth request');
      return next.handle(request);
    }

    // Add auth header if user is authenticated
    if (this.authService.accessToken) {
      console.log('Adding auth header');
      request = this.addAuthHeader(request, this.authService.accessToken);
    } else {
      console.log('No access token available');
    }

    // Add CSRF token if available
    if (this.authService.csrfToken) {
      console.log('Adding CSRF header');
      request = this.addCsrfHeader(request, this.authService.csrfToken);
    }

    return next.handle(request).pipe(
      catchError(error => {
        if (error instanceof HttpErrorResponse) {
          console.log(`Error response: ${error.status} from ${request.url}`);
          
          if (error.status === 401) {
            console.log('401 Unauthorized error - attempting to refresh token');
            // Only try to refresh if not already refreshing and we have a refresh token
            if (this.authService.refreshToken) {
              return this.handle401Error(request, next);
            } else {
              console.log('No refresh token available, redirecting to login');
              this.authService.clearAuthState();
              this.router.navigateByUrl('/login');
            }
          }
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

      console.log('Attempting to refresh access token');
      return this.authService.refreshAccessToken().pipe(
        switchMap(response => {
          this.isRefreshing = false;
          this.refreshTokenSubject.next(response.accessToken);
          console.log('Token refresh successful, retrying request with new token');
          return next.handle(this.addAuthHeader(request, response.accessToken));
        }),
        catchError(error => {
          this.isRefreshing = false;
          console.error('Token refresh failed:', error);
          // Force logout on refresh error
          this.authService.clearAuthState();
          this.router.navigateByUrl('/login');
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
      switchMap(token => {
        console.log('Using newly refreshed token for request');
        return next.handle(this.addAuthHeader(request, token));
      })
    );
  }
} 