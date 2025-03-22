import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, throwError, catchError } from 'rxjs';
import { isPlatformBrowser } from '@angular/common';
import { 
  User, 
  UserLogin, 
  UserRegistration, 
  AuthResponse,
  RefreshTokenRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest 
} from '../../models';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly API_URL = `${environment.apiUrl}/auth`;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  private accessTokenSubject = new BehaviorSubject<string | null>(null);
  private refreshTokenSubject = new BehaviorSubject<string | null>(null);
  private csrfTokenSubject = new BehaviorSubject<string | null>(null);
  private platformId = inject(PLATFORM_ID);

  // Exposed as observables
  currentUser$ = this.currentUserSubject.asObservable();
  accessToken$ = this.accessTokenSubject.asObservable();
  csrfToken$ = this.csrfTokenSubject.asObservable();

  constructor(private http: HttpClient) {
    // Only load auth state if in browser environment
    if (isPlatformBrowser(this.platformId)) {
      this.loadAuthStateFromStorage();
    }
  }

  // Getters for values
  get currentUser(): User | null {
    return this.currentUserSubject.value;
  }

  get accessToken(): string | null {
    return this.accessTokenSubject.value;
  }

  get refreshToken(): string | null {
    return this.refreshTokenSubject.value;
  }

  get csrfToken(): string | null {
    return this.csrfTokenSubject.value;
  }

  get isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  // Login
  login(credentials: UserLogin): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.API_URL}/login`, credentials)
      .pipe(
        tap(response => this.handleAuthResponse(response))
      );
  }

  // Register
  register(userData: UserRegistration): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.API_URL}/register`, userData)
      .pipe(
        tap(response => this.handleAuthResponse(response))
      );
  }

  // Logout
  logout(): Observable<any> {
    if (!this.refreshToken) {
      this.clearAuthState();
      return throwError(() => new Error('No refresh token available'));
    }

    const request: RefreshTokenRequest = { refreshToken: this.refreshToken };
    return this.http.post(`${this.API_URL}/logout`, request)
      .pipe(
        tap(() => this.clearAuthState())
      );
  }

  // Refresh token
  refreshAccessToken(): Observable<AuthResponse> {
    if (!this.refreshToken) {
      return throwError(() => new Error('No refresh token available'));
    }

    const request: RefreshTokenRequest = { refreshToken: this.refreshToken };
    return this.http.post<AuthResponse>(`${this.API_URL}/refresh`, request)
      .pipe(
        tap(response => this.handleAuthResponse(response))
      );
  }

  // Get user profile
  getUserProfile(): Observable<User> {
    return this.http.get<User>(`${this.API_URL}/profile`);
  }

  // Forgot password
  forgotPassword(email: string): Observable<any> {
    const request: ForgotPasswordRequest = { email };
    console.log('AuthService.forgotPassword called with:', email);
    console.log('Request URL:', `${this.API_URL}/forgot-password`);
    console.log('Full API_URL value:', this.API_URL);
    
    // Mock implementation for testing when backend is not available
    if (true) { // Change to 'if (true)' to use mock, 'if (false)' to use real API
      console.log('Using mock implementation for forgotPassword');
      // Simulate a delay like a real API call would have
      return new Observable(observer => {
        setTimeout(() => {
          // Simulate a successful response
          const mockResponse = { 
            success: true, 
            message: 'If the email exists, a password reset link will be sent',
            resetToken: 'mock-token-for-testing'
          };
          console.log('Mock forgot password response:', mockResponse);
          observer.next(mockResponse);
          observer.complete();
        }, 1000); // 1 second delay to simulate network latency
      });
    }
    
    // Real implementation when backend is available
    return this.http.post(`${this.API_URL}/forgot-password`, request).pipe(
      tap(response => console.log('Forgot password response:', response)),
      catchError(error => {
        console.error('Forgot password HTTP error:', error);
        return throwError(() => error);
      })
    );
  }

  // Verify reset token
  verifyResetToken(token: string): Observable<any> {
    return this.http.post(`${this.API_URL}/verify-reset-token`, { token });
  }

  // Reset password
  resetPassword(resetData: ResetPasswordRequest): Observable<any> {
    return this.http.post(`${this.API_URL}/reset-password`, resetData);
  }

  // Validate CSRF token
  validateCsrfToken(): Observable<any> {
    return this.http.post(`${this.API_URL}/validate-csrf`, {});
  }

  // Private helper methods
  private handleAuthResponse(response: AuthResponse): void {
    this.currentUserSubject.next(response.user);
    this.accessTokenSubject.next(response.accessToken);
    this.refreshTokenSubject.next(response.refreshToken);
    this.csrfTokenSubject.next(response.csrfToken);
    
    // Only save to storage if in browser environment
    if (isPlatformBrowser(this.platformId)) {
      this.saveAuthStateToStorage(response);
    }
  }

  private saveAuthStateToStorage(authResponse: AuthResponse): void {
    // Check for browser environment before accessing localStorage
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('user', JSON.stringify(authResponse.user));
      localStorage.setItem('accessToken', authResponse.accessToken);
      localStorage.setItem('refreshToken', authResponse.refreshToken);
      localStorage.setItem('csrfToken', authResponse.csrfToken);
    }
  }

  private loadAuthStateFromStorage(): void {
    // Check for browser environment before accessing localStorage
    if (isPlatformBrowser(this.platformId)) {
      const userJson = localStorage.getItem('user');
      const accessToken = localStorage.getItem('accessToken');
      const refreshToken = localStorage.getItem('refreshToken');
      const csrfToken = localStorage.getItem('csrfToken');

      if (userJson && accessToken) {
        this.currentUserSubject.next(JSON.parse(userJson));
        this.accessTokenSubject.next(accessToken);
        
        if (refreshToken) {
          this.refreshTokenSubject.next(refreshToken);
        }
        
        if (csrfToken) {
          this.csrfTokenSubject.next(csrfToken);
        }
      }
    }
  }

  private clearAuthState(): void {
    this.currentUserSubject.next(null);
    this.accessTokenSubject.next(null);
    this.refreshTokenSubject.next(null);
    this.csrfTokenSubject.next(null);
    
    // Check for browser environment before accessing localStorage
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('user');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('csrfToken');
    }
  }
} 