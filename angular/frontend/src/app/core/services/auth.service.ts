import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, throwError, catchError, map, mergeMap, of } from 'rxjs';
import { isPlatformBrowser } from '@angular/common';
import { 
  User, 
  UserLogin, 
  UserRegistration, 
  AuthResponse,
  RefreshTokenRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  VerificationResponse
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
  
  // For testing purposes - will store the most recent verification token
  private testVerificationTokenSubject = new BehaviorSubject<string | null>(null);
  testVerificationToken$ = this.testVerificationTokenSubject.asObservable();

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
  
  get testVerificationToken(): string | null {
    return this.testVerificationTokenSubject.value;
  }

  get isAuthenticated(): boolean {
    return !!this.accessToken && !!this.currentUser;
  }

  /**
   * Check if the current user has a specific role
   * @param role The role to check for
   * @returns True if the user has the specified role, false otherwise
   */
  hasRole(role: string): boolean {
    return !!this.currentUser?.roles?.includes(role);
  }

  // Public method to refresh auth state from storage
  refreshAuthStateFromStorage(): void {
    console.log('Refreshing auth state from storage');
    if (isPlatformBrowser(this.platformId)) {
      this.loadAuthStateFromStorage();
      console.log('Auth state after refresh - isAuthenticated:', this.isAuthenticated);
    }
  }

  // Login
  login(credentials: UserLogin): Observable<AuthResponse> {
    console.log('AuthService.login called with:', {
      email: credentials.email,
      password: '******' // Don't log the actual password
    });
    console.log('Request URL:', `${this.API_URL}/login`);

    return this.http.post<any>(`${this.API_URL}/login`, credentials)
      .pipe(
        map(response => {
          console.log('Raw login response:', {
            ...response,
            access_token: '******',
            refresh_token: '******',
            csrf_token: '******'
          });

          // Validate token response
          if (!response || !response.access_token || !response.refresh_token) {
            throw new Error('Invalid login response: missing token data');
          }

          // Store tokens temporarily
          const tokens = {
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
            csrfToken: response.csrf_token,
            expiresIn: response.expires_in || 3600
          };

          // Return an observable that will fetch the user profile
          return this.http.get<User>(`${this.API_URL}/profile`, {
            headers: {
              'Authorization': `Bearer ${tokens.accessToken}`
            }
          }).pipe(
            map(user => {
              // Combine tokens with user data
              const authResponse: AuthResponse = {
                user: user,
                ...tokens,
                requiresVerification: false
              };

              console.log('Complete login response:', {
                ...authResponse,
                accessToken: '******',
                refreshToken: '******',
                csrfToken: '******'
              });

              return authResponse;
            })
          );
        }),
        mergeMap(observable => observable),
        tap(response => {
          // Handle the auth response synchronously
          this.handleAuthResponse(response);
          
          // Verify the state was updated correctly
          if (!this.isAuthenticated) {
            throw new Error('Authentication state not properly updated');
          }
          
          console.log('Auth state updated successfully');
        }),
        catchError(error => {
          console.error('Login error:', error);
          // Clear any partial state on error
          this.clearAuthState();
          return throwError(() => error);
        })
      );
  }

  // Register
  register(userData: UserRegistration): Observable<AuthResponse> {
    console.log('AuthService.register called with:', {
      ...userData,
      password: '******' // Don't log the actual password
    });
    console.log('Request URL:', `${this.API_URL}/register`);
    
    // Use real HTTP implementation
    return this.http.post<AuthResponse>(`${this.API_URL}/register`, userData)
      .pipe(
        tap(response => {
          console.log('Registration successful');
          this.handleAuthResponse(response);
        }),
        catchError(error => {
          console.error('Registration HTTP error:', error);
          return throwError(() => error);
        })
      );
  }

  // Logout
  logout(): Observable<any> {
    console.log('AuthService.logout called, refresh token available:', !!this.refreshToken);
    
    if (!this.refreshToken) {
      console.warn('No refresh token available for logout, clearing auth state only');
      this.clearAuthState();
      return of({ success: true, message: 'Logged out successfully (local only)' });
    }

    const request: RefreshTokenRequest = { refreshToken: this.refreshToken };
    console.log('Sending logout request to backend');
    
    return this.http.post(`${this.API_URL}/logout`, request)
      .pipe(
        tap((response) => {
          console.log('Logout successful, clearing auth state', response);
          this.clearAuthState();
        }),
        catchError(error => {
          console.error('Error during logout API call:', error);
          // Still clear auth state locally even if API call fails
          this.clearAuthState();
          return of({ success: true, message: 'Logged out locally despite API error' });
        })
      );
  }

  // Refresh token
  refreshAccessToken(): Observable<AuthResponse> {
    if (!this.refreshToken) {
      return throwError(() => new Error('No refresh token available'));
    }

    // Ensure refresh token is a string and properly formatted
    if (typeof this.refreshToken !== 'string' || this.refreshToken.trim() === '') {
      console.error('Invalid refresh token format:', this.refreshToken);
      this.clearAuthState();
      return throwError(() => new Error('Invalid refresh token format'));
    }

    const request: RefreshTokenRequest = { refreshToken: this.refreshToken };
    console.log('Sending refresh token request with token type:', typeof this.refreshToken);
    
    return this.http.post<AuthResponse>(`${this.API_URL}/refresh`, request)
      .pipe(
        tap(response => this.handleAuthResponse(response)),
        catchError(error => {
          console.error('Token refresh error:', error);
          // If we get an invalid token error, clear the auth state
          if (error.status === 400) {
            this.clearAuthState();
          }
          return throwError(() => error);
        })
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
    if (false) { // Changed to use the real API implementation
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

  // Verify email
  verifyEmail(token: string, email: string): Observable<VerificationResponse> {
    console.log('AuthService.verifyEmail called with token:', token, 'and email:', email);
    
    if (!token) {
      return throwError(() => new Error('Verification token is required'));
    }
    
    if (!email) {
      return throwError(() => new Error('Email is required for verification'));
    }
    
    // Mock implementation for testing when backend is not available
    if (false) { // Changed to use the real API implementation
      console.log('Using mock implementation for email verification');
      
      return new Observable(observer => {
        setTimeout(() => {
          try {
            // Validate token (in a real app, this would be done on the server)
            if (token.length < 5) {
              throw new Error('Invalid verification token');
            }
            
            // Simulate a successful response
            const mockUser: User = {
              id: Math.floor(Math.random() * 1000) + 1, // Random ID
              email: email,
              firstName: email.split('@')[0], // Use part of email as first name for mock
              lastName: 'User',
              emailVerified: true, // Mark as verified
              roles: ['user'],
              createdAt: new Date(),
              updatedAt: new Date()
            };
            
            // Create tokens that are guaranteed to be strings
            const accessToken = `mock-access-token-${Date.now()}`;
            const refreshToken = `mock-refresh-token-${Date.now()}`;
            const csrfToken = `mock-csrf-token-${Date.now()}`;
            
            const mockResponse: VerificationResponse = {
              user: mockUser,
              success: true,
              message: 'Email verified successfully.',
              accessToken: accessToken,
              refreshToken: refreshToken,
              csrfToken: csrfToken
            };
            
            // Update auth state with the verified user
            this.handleAuthResponse({
              user: mockUser,
              accessToken: accessToken,
              refreshToken: refreshToken,
              csrfToken: csrfToken,
              expiresIn: 3600,
              requiresVerification: false
            });
            
            console.log('Mock verification response:', {
              ...mockResponse,
              accessToken: '******',
              refreshToken: '******',
              csrfToken: '******'
            });
            
            observer.next(mockResponse);
            observer.complete();
          } catch (error: any) {
            console.error('Error in mock email verification:', error);
            observer.error({
              error: {
                message: error.message || 'Email verification failed'
              },
              status: 400,
              statusText: 'Bad Request'
            });
          }
        }, 1500); // 1.5 second delay to simulate network latency
      });
    }
    
    // Real implementation when backend is available
    return this.http.post<VerificationResponse>(`${this.API_URL}/verify-email`, { token, email }).pipe(
      tap(response => {
        // Update auth state with the verified user if all required properties are present
        if (response.success && response.accessToken && response.refreshToken && response.csrfToken) {
          this.handleAuthResponse({
            user: response.user,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            csrfToken: response.csrfToken,
            expiresIn: response.expiresIn || 3600, // Default expiry if not provided
            requiresVerification: false
          });
        }
      })
    );
  }

  // Delete account
  deleteAccount(): Observable<any> {
    console.log('AuthService.deleteAccount called');
    
    // Mock implementation for testing when backend is not available
    if (false) { // Changed to use the real API implementation
      console.log('Using mock implementation for account deletion');
      
      return new Observable(observer => {
        setTimeout(() => {
          // Simulate a successful response
          const mockResponse = {
            success: true,
            message: 'Account deleted successfully.'
          };
          
          console.log('Mock account deletion response:', mockResponse);
          observer.next(mockResponse);
          observer.complete();
        }, 1500);
      });
    }
    
    return this.http.delete<any>(`${this.API_URL}/delete-account`);
  }

  // Private helper methods
  private handleAuthResponse(response: AuthResponse): void {
    console.log('Handling auth response');
    
    // Validate response data
    if (!response.user || !response.accessToken || !response.refreshToken) {
      console.error('Invalid auth response:', response);
      throw new Error('Invalid auth response: missing required data');
    }
    
    // Update state in memory
    this.currentUserSubject.next(response.user);
    this.accessTokenSubject.next(response.accessToken);
    this.refreshTokenSubject.next(response.refreshToken);
    this.csrfTokenSubject.next(response.csrfToken);
    
    // Save to storage if in browser environment
    if (isPlatformBrowser(this.platformId)) {
      try {
        this.saveAuthStateToStorage(response);
        console.log('Auth state saved to storage');
      } catch (error) {
        console.error('Error saving auth state to storage:', error);
        throw error;
      }
    }
  }

  private saveAuthStateToStorage(authResponse: AuthResponse): void {
    // Check for browser environment before accessing localStorage
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem('user', JSON.stringify(authResponse.user));
        localStorage.setItem('accessToken', authResponse.accessToken);
        localStorage.setItem('refreshToken', authResponse.refreshToken);
        localStorage.setItem('csrfToken', authResponse.csrfToken);
        
        // Save debug info if available (development only)
        if (authResponse.debugInfo) {
          localStorage.setItem('authDebugInfo', JSON.stringify(authResponse.debugInfo));
        }
        
        // Verify storage was updated correctly
        const storedUser = localStorage.getItem('user');
        const storedToken = localStorage.getItem('accessToken');
        
        if (!storedUser || !storedToken) {
          throw new Error('Failed to save auth state to storage');
        }
      } catch (error) {
        console.error('Error saving to localStorage:', error);
        // Clear any partial state
        this.clearAuthState();
        throw error;
      }
    }
  }

  private loadAuthStateFromStorage(): void {
    // Check for browser environment before accessing localStorage
    if (isPlatformBrowser(this.platformId)) {
      try {
        const userJson = localStorage.getItem('user');
        const accessToken = localStorage.getItem('accessToken');
        let refreshToken = localStorage.getItem('refreshToken');
        const csrfToken = localStorage.getItem('csrfToken');
        const testToken = localStorage.getItem('testVerificationToken');

        console.log('Loading auth state from storage - found tokens:', { 
          hasUser: !!userJson, 
          hasAccessToken: !!accessToken,
          hasRefreshToken: !!refreshToken
        });

        // Only try to parse and set user data if both user and token exist
        if (userJson && accessToken) {
          try {
            const user = JSON.parse(userJson);
            
            // Validate tokens format (simple check)
            const isValidAccessToken = typeof accessToken === 'string' && accessToken.length > 20;
            const isValidRefreshToken = typeof refreshToken === 'string' && refreshToken.length > 20;
            
            if (!isValidAccessToken) {
              console.warn('Invalid access token format in localStorage, clearing auth state');
              this.clearAuthState();
              return;
            }
            
            if (!isValidRefreshToken && refreshToken !== null) {
              console.warn('Invalid refresh token format in localStorage, clearing refresh token');
              localStorage.removeItem('refreshToken');
              refreshToken = null;
            }
            
            // Validate that user object has required fields
            if (user && user.id && user.email && isValidAccessToken) {
              console.log('Valid auth data found in localStorage, setting auth state');
              this.currentUserSubject.next(user);
              this.accessTokenSubject.next(accessToken);
              
              if (refreshToken) {
                this.refreshTokenSubject.next(refreshToken);
              }
              
              if (csrfToken) {
                this.csrfTokenSubject.next(csrfToken);
              }
            } else {
              console.warn('Invalid user data in localStorage, clearing auth state');
              this.clearAuthState();
            }
          } catch (error) {
            console.error('Error parsing user data from localStorage:', error);
            this.clearAuthState(); // Clear invalid data
          }
        } else {
          // Clear any partial state if either user or token is missing
          console.log('Incomplete auth data in localStorage, clearing auth state');
          this.clearAuthState();
        }
        
        // Load test verification token if available
        if (testToken) {
          this.testVerificationTokenSubject.next(testToken);
        }
      } catch (error) {
        console.error('Error accessing localStorage:', error);
        this.clearAuthState(); // Clear potentially corrupted data
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