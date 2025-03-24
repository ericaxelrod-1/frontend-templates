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
    return !!this.accessToken;
  }

  // Login
  login(credentials: UserLogin): Observable<AuthResponse> {
    console.log('AuthService.login called with:', {
      email: credentials.email,
      password: '******' // Don't log the actual password
    });
    console.log('Request URL:', `${this.API_URL}/login`);

    // Always use mock implementation for demo purposes
    console.log('Using mock implementation for login');
    // Simulate a delay like a real API call would have
    return new Observable(observer => {
      setTimeout(() => {
        try {
          // Check for required fields
          if (!credentials.email || !credentials.password) {
            throw new Error('Email and password are required');
          }

          // Validate email format
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(credentials.email)) {
            throw new Error('Invalid email format');
          }

          // For demo, simulate a successful login with any valid email and password
          // In a real implementation, you would validate credentials against a backend
          const userId = Math.floor(Math.random() * 10000);
          const mockUser: User = {
            id: userId,
            email: credentials.email,
            firstName: 'Demo',
            lastName: 'User',
            roles: ['user'],
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date()
          };

          // Generate mock tokens
          const mockAccessToken = `mock-access-token-${Date.now()}`;
          const mockRefreshToken = `mock-refresh-token-${Date.now()}`;
          const mockCsrfToken = `mock-csrf-token-${Date.now()}`;

          // Create mock response
          const response: AuthResponse = {
            user: mockUser,
            accessToken: mockAccessToken,
            refreshToken: mockRefreshToken,
            csrfToken: mockCsrfToken,
            expiresIn: 3600
          };

          // Log the successful login
          console.log('Login successful:', { userId: mockUser.id, email: mockUser.email });
          
          // Return successful response
          observer.next(response);
          observer.complete();
          
          // Handle auth response to set tokens and user
          this.handleAuthResponse(response);
        } catch (error: any) {
          console.error('Login error:', error);
          observer.error({
            error: {
              message: error.message,
              statusCode: 400
            }
          });
        }
      }, 800); // Simulate network delay
    });
  }

  // Register
  register(userData: UserRegistration): Observable<AuthResponse> {
    console.log('AuthService.register called with:', {
      ...userData,
      password: '******' // Don't log the actual password
    });
    console.log('Request URL:', `${this.API_URL}/register`);
    
    // Always use mock implementation for demo purposes
    console.log('Using mock implementation for register');
    // Simulate a delay like a real API call would have
    return new Observable(observer => {
      setTimeout(() => {
        try {
          // Check for required fields
          if (!userData.email || !userData.password) {
            throw new Error('Email and password are required');
          }
          
          // Validate email format
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(userData.email)) {
            throw new Error('Invalid email format');
          }
          
          // Validate password strength
          if (userData.password.length < 8) {
            throw new Error('Password must be at least 8 characters long');
          }
          
          // Generate a test verification token for development purposes
          const testToken = `TEST-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${Date.now().toString().substring(8)}`;
          
          // Store the test token for verification purposes
          this.testVerificationTokenSubject.next(testToken);
          // Also store in localStorage for persistence
          if (isPlatformBrowser(this.platformId)) {
            localStorage.setItem('testVerificationToken', testToken);
          }
          
          console.log('[DEVELOPMENT ONLY] Generated verification token:', testToken);
          
          // Simulate a successful response
          const mockUser: User = {
            id: Math.floor(Math.random() * 1000) + 1, // Random ID
            email: userData.email,
            firstName: userData.firstName || 'John',
            lastName: userData.lastName || 'Doe',
            emailVerified: false, // Default to false for new registrations
            roles: ['user'],
            createdAt: new Date(), // Current date
            updatedAt: new Date()  // Current date
          };
          
          const mockResponse: AuthResponse = { 
            accessToken: `mock-access-token-${Date.now()}`,
            refreshToken: `mock-refresh-token-${Date.now()}`,
            user: mockUser,
            csrfToken: `mock-csrf-token-${Date.now()}`,
            expiresIn: 3600, // 1 hour expiration
            requiresVerification: true, // Require email verification
            // Include verification details in development mode
            debugInfo: {
              verificationToken: testToken,
              emailSent: true,
              emailSender: 'noreply@angular-template.com',
              emailSubject: 'Verify Your Email Address',
              sent: new Date().toISOString()
            }
          };
          
          console.log('Mock register response:', {
            ...mockResponse,
            accessToken: '******',
            refreshToken: '******',
            csrfToken: '******'
          });
          
          // Save auth state to storage
          this.handleAuthResponse(mockResponse);
          
          observer.next(mockResponse);
          observer.complete();
        } catch (error: any) {
          console.error('Error in mock register implementation:', error);
          observer.error({
            error: {
              message: error.message || 'Registration failed'
            },
            status: 400,
            statusText: 'Bad Request'
          });
        }
      }, 1000); // 1 second delay to simulate network latency
    });
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
    if (true) { // Change to 'if (true)' to use mock, 'if (false)' to use real API
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
    if (true) { // Change to 'if (true)' to use mock, 'if (false)' to use real API
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
      
      // Save debug info if available (development only)
      if (authResponse.debugInfo) {
        localStorage.setItem('authDebugInfo', JSON.stringify(authResponse.debugInfo));
      }
    }
  }

  private loadAuthStateFromStorage(): void {
    // Check for browser environment before accessing localStorage
    if (isPlatformBrowser(this.platformId)) {
      const userJson = localStorage.getItem('user');
      const accessToken = localStorage.getItem('accessToken');
      const refreshToken = localStorage.getItem('refreshToken');
      const csrfToken = localStorage.getItem('csrfToken');
      const testToken = localStorage.getItem('testVerificationToken');

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
      
      // Load test verification token if available
      if (testToken) {
        this.testVerificationTokenSubject.next(testToken);
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