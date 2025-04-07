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
import { catchError, filter, take, switchMap, finalize, tap } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { environment } from '../../../environments/environment';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private refreshTokenInProgress = false;
  private refreshTokenSubject = new BehaviorSubject<string | null>(null);

  constructor(private authService: AuthService) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Skip token for certain requests
    if (this.shouldSkipToken(request)) {
      return next.handle(request);
    }

    // Add auth token if available
    const accessToken = this.authService.accessToken;
    const csrfToken = this.authService.csrfToken;
    
    if (accessToken) {
      request = this.addAuthenticationToken(request, accessToken, csrfToken);
    }

    // Handle the request and check for 401 errors
    return next.handle(request).pipe(
      tap(event => {
        // Optionally handle successful responses if needed
        if (event instanceof HttpResponse) {
          // You can do something with successful responses here
        }
      }),
      catchError((error: HttpErrorResponse) => {
        // Special handling for logout - don't retry on 400 errors during logout
        if (request.url.includes('/api/auth/logout') && error.status === 400) {
          console.log('Error response: 400 from logout endpoint - ignoring and proceeding with logout');
          // Return a successful completion for logout 400 errors
          return of(new HttpResponse({ status: 200, body: { success: true, message: 'Logged out successfully' } }));
        }
        
        // Handle 401 - unauthorized errors
        if (error.status === 401) {
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
    // Skip auth token for login, register, and token refresh endpoints
    const skipUrls = [
      `${environment.apiUrl}/auth/login`,
      `${environment.apiUrl}/auth/register`,
      `${environment.apiUrl}/auth/refresh`
    ];
    
    return skipUrls.some(url => request.url.includes(url));
  }

  private handle401Error(request: HttpRequest<unknown>, next: HttpHandler, originalError: HttpErrorResponse): Observable<HttpEvent<unknown>> {
    // Avoid infinite loop of token refresh
    if (request.url.includes('/api/auth/refresh')) {
      // Instead of clearAuthState, call logout which will clear the state
      this.authService.logout().subscribe();
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
    return from(this.authService.refreshAccessToken().pipe(
      switchMap(response => {
        // Token refresh successful - notify waiters and retry the request
        this.refreshTokenInProgress = false;
        this.refreshTokenSubject.next(response.accessToken);
        
        return next.handle(this.addAuthenticationToken(
          request, 
          response.accessToken,
          response.csrfToken
        ));
      }),
      catchError(error => {
        // Token refresh failed - proceed to logout
        this.refreshTokenInProgress = false;
        this.refreshTokenSubject.next(null);
        // Instead of clearAuthState, call logout which will clear the state
        this.authService.logout().subscribe();
        
        return throwError(() => originalError);
      }),
      finalize(() => {
        this.refreshTokenInProgress = false;
      })
    ));
  }
} 