import { Injectable } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor,
  HttpErrorResponse,
  HttpResponse
} from '@angular/common/http';
import { Observable, throwError, BehaviorSubject, from, of } from 'rxjs';
import { catchError, filter, take, switchMap, finalize } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { environment } from '../../../environments/environment';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private refreshTokenInProgress = false;
  private refreshTokenSubject = new BehaviorSubject<string | null>(null);

  constructor(private authService: AuthService) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Skip token for non-API requests or specific auth endpoints
    if (this.shouldSkipToken(request)) {
      return next.handle(request);
    }

    // Get current token synchronously
    const currentToken = this.authService.accessToken;

    // If token exists, add it and proceed
    if (currentToken) {
      request = this.addAuthenticationToken(request, currentToken, this.authService.csrfToken);
    } else {
      // Log if proceeding without a token (useful for debugging)
      console.log(`AuthInterceptor: No token found. Proceeding without auth header for request: ${request.url}`);
    }

    // Handle the request (passing the potentially modified request)
    return this.handleRequest(request, next);
  }
  
  // Extracted request handling logic for reuse
  private handleRequest(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(request).pipe(
      catchError((error: HttpErrorResponse) => {
        // Special handling for logout - don't retry on 400 errors during logout
        if (request.url.includes('/api/auth/logout') && error.status === 400) {
          console.log('AuthInterceptor: Ignoring 400 from logout endpoint.');
          return of(new HttpResponse({ status: 200, body: { success: true, message: 'Logged out successfully' } }));
        }
        
        // Handle 401 - unauthorized errors (potential token refresh)
        if (error.status === 401 && !request.url.includes('/api/auth/refresh')) {
           console.log(`AuthInterceptor: Received 401 for ${request.url}. Attempting token refresh.`);
          return this.handle401Error(request, next, error);
        }

        // For all other errors, forward them along
        return throwError(() => error);
      })
    );
  }

  private addAuthenticationToken(request: HttpRequest<unknown>, token: string, csrfToken: string | null): HttpRequest<unknown> {
    let clonedRequest = request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
    
    // Add CSRF token if available for non-GET requests
    if (csrfToken && request.method !== 'GET') {
      clonedRequest = clonedRequest.clone({
        setHeaders: {
          'X-CSRF-Token': csrfToken
        }
      });
    }
    
    return clonedRequest;
  }

  private shouldSkipToken(request: HttpRequest<unknown>): boolean {
    // Skip auth token for all public auth endpoints
    const skipUrls = [
      `${environment.apiUrl}/auth/login`,
      `${environment.apiUrl}/auth/register`,
      `${environment.apiUrl}/auth/refresh`,
      `${environment.apiUrl}/auth/forgot-password`,
      `${environment.apiUrl}/auth/reset-password`,
      `${environment.apiUrl}/auth/verify-email`
    ];
    
    const isPublicEndpoint = skipUrls.some(url => request.url.includes(url));
    
    if (isPublicEndpoint) {
      console.log(`AuthInterceptor: Skipping token for public endpoint: ${request.url}`);
    }
    
    return isPublicEndpoint;
  }

  private handle401Error(request: HttpRequest<unknown>, next: HttpHandler, originalError: HttpErrorResponse): Observable<HttpEvent<unknown>> {
    // If this is a public endpoint, don't try to refresh the token
    if (this.shouldSkipToken(request)) {
      console.log(`AuthInterceptor: Received 401 for public endpoint ${request.url}, not attempting token refresh`);
      return throwError(() => originalError);
    }
    
    // Avoid infinite loop of token refresh
    if (request.url.includes('/api/auth/refresh')) {
      // Call logout and ignore the result as we're going to throw anyway
      this.authService.logout().subscribe(() => {
        console.log('Logged out after refresh token failure during refresh attempt');
      });
      return throwError(() => originalError);
    }
    
    // If token refresh is in progress, wait for it to complete
    if (this.refreshTokenInProgress) {
      return this.refreshTokenSubject.pipe(
        filter(token => token !== null),
        take(1),
        switchMap(token => {
          return next.handle(this.addAuthenticationToken(request, token!, this.authService.csrfToken));
        })
      );
    }
    
    this.refreshTokenInProgress = true;
    this.refreshTokenSubject.next(null);
    
    // Try to refresh the token
    console.log(`AuthInterceptor: Attempting to refresh token for endpoint: ${request.url}`);
    return from(this.authService.refreshAccessToken().pipe(
      switchMap(response => {
        // Token refresh successful - notify waiters and retry the request
        console.log('AuthInterceptor: Token refresh successful, retrying original request');
        this.refreshTokenInProgress = false;
        this.refreshTokenSubject.next(response.accessToken);
        
        return next.handle(this.addAuthenticationToken(
          request, 
          response.accessToken,
          response.csrfToken
        ));
      }),
      catchError((refreshError) => {
        // Token refresh failed - proceed to logout
        console.error('AuthInterceptor: Token refresh failed:', refreshError.status, refreshError.message);
        this.refreshTokenInProgress = false;
        this.refreshTokenSubject.next(null);
        // Call logout and ignore the result as we're going to throw anyway
        this.authService.logout().subscribe(() => {
          console.log('Logged out after refresh token failure');
        });
        
        return throwError(() => originalError);
      }),
      finalize(() => {
        this.refreshTokenInProgress = false;
      })
    ));
  }
} 