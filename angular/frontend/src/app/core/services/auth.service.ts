import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, throwError, catchError, of, take } from 'rxjs';
import { isPlatformBrowser } from '@angular/common';
import { 
  User, 
  UserLogin,
  AuthResponse,
  RefreshTokenRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  VerificationResponse,
  PasswordChangeRequest,
  Permission,
  UserRegistration
} from '../../models';
import { environment } from '../../../environments/environment';
import { Router } from '@angular/router';

// Interface for auth status response
export interface AuthStatus {
  isAuthenticated: boolean;
  user: User | null;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly API_URL = `${environment.apiUrl}/auth`;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  private accessTokenSubject = new BehaviorSubject<string | null>(null);
  private refreshTokenSubject = new BehaviorSubject<string | null>(null);
  private csrfTokenSubject = new BehaviorSubject<string | null>(null);
  private activeGroupIdSubject = new BehaviorSubject<number | null>(null);
  private platformId = inject(PLATFORM_ID);
  
  // Make these public for template access
  public currentUser: User | null = null;
  public userPermissions: Permission[] = [];
  private permissionCache = new Map<string, boolean>();
  
  // For testing purposes - will store the most recent verification token
  private testVerificationTokenSubject = new BehaviorSubject<string | null>(null);
  testVerificationToken$ = this.testVerificationTokenSubject.asObservable();

  // Exposed as observables
  currentUser$ = this.currentUserSubject.asObservable();
  accessToken$ = this.accessTokenSubject.asObservable();
  csrfToken$ = this.csrfTokenSubject.asObservable();
  activeGroupId$ = this.activeGroupIdSubject.asObservable();

  // Add a subject to signal when initialization is complete
  private isInitializedSubject = new BehaviorSubject<boolean>(false);
  isInitialized$ = this.isInitializedSubject.asObservable();

  // Public getter for synchronous check
  public get isInitialized(): boolean {
    return this.isInitializedSubject.value;
  }

  constructor(
    private http: HttpClient,
    private router: Router
  ) {
    // Subscribe to currentUser$ to keep currentUser property in sync
    this.currentUser$.subscribe(user => {
      this.currentUser = user;
      if (user) {
        this.userPermissions = user.permissions || [];
        this.permissionCache.clear(); // Clear cache when user/permissions change
        
        // Default active group to user's first group if not already set
        if (!this.activeGroupIdSubject.value && user.groups && user.groups.length > 0) {
          const firstGroupId = user.groups[0].id;
          if (firstGroupId !== undefined) {
            this.activeGroupIdSubject.next(firstGroupId);
          }
        }
      } else {
        this.userPermissions = [];
        this.permissionCache.clear();
        this.activeGroupIdSubject.next(null);
      }
    });
    // NOTE: Removed the direct call to loadAuthStateFromStorage from constructor
    // Initialization is now handled solely by initializeAuthState called via APP_INITIALIZER
  }

  // Public getters
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
    return !!this.accessToken && !!this.currentUser;
  }

  getActiveGroupId(): number | null {
    return this.activeGroupIdSubject.value;
  }

  setActiveGroupId(id: number): void {
    this.activeGroupIdSubject.next(id);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('activeGroupId', id.toString());
    }
  }

  /**
   * Check if the current user has a specific permission
   * @param resourceName The resource to check access for
   * @param actionName The action to check permission for
   * @returns True if the user has the permission, false otherwise
   */
  hasPermission(resourceName: string, actionName: string): boolean {
    const cacheKey = `${resourceName}:${actionName}`;
    if (this.permissionCache.has(cacheKey)) {
      return this.permissionCache.get(cacheKey)!;
    }

    const hasPermission = this.userPermissions.some(
      p => p.resourceName === resourceName && p.actionName === actionName
    );
    this.permissionCache.set(cacheKey, hasPermission);
    return hasPermission;
  }

  /**
   * Check if the current user has any of the specified permissions
   * @param permissions Array of permission objects with resourceName and actionName
   * @returns True if the user has any of the permissions, false otherwise
   */
  hasAnyPermission(permissions: { resourceName: string; actionName: string }[]): boolean {
    return permissions.some(({ resourceName, actionName }) => 
      this.hasPermission(resourceName, actionName)
    );
  }

  /**
   * Check if the current user has all of the specified permissions
   * @param permissions Array of permission objects with resourceName and actionName
   * @returns True if the user has all of the permissions, false otherwise
   */
  hasAllPermissions(permissions: { resourceName: string; actionName: string }[]): boolean {
    return permissions.every(({ resourceName, actionName }) => 
      this.hasPermission(resourceName, actionName)
    );
  }

  /**
   * Initializes the authentication state by loading tokens from storage,
   * attempting a refresh if tokens exist, and only setting state upon success.
   * Designed to be used with APP_INITIALIZER.
   * @returns Observable<boolean> emitting true if auth state restored/refreshed, false otherwise.
   */
  initializeAuthState(): Observable<boolean> {
    this.isInitializedSubject.next(false);

    if (!isPlatformBrowser(this.platformId)) {
      this.isInitializedSubject.next(true);
      return of(false);
    }

    return new Observable<boolean>(observer => {
      try {
        const storedData = this.readAuthStateFromStorage();

        if (storedData.accessToken && storedData.refreshToken) {
          this.refreshAccessToken(storedData.refreshToken)
            .subscribe({
              next: () => {
                observer.next(true);
                observer.complete();
              },
              error: (refreshError) => {
                this.clearAuthState();
                observer.next(false);
                observer.complete();
              }
            });
        } else {
          this.clearAuthState();
          observer.next(false);
          observer.complete();
        }
      } catch (error) {
        this.clearAuthState();
        observer.next(false);
        observer.complete();
      }
    }).pipe(
      take(1),
      tap(result => {
         this.isInitializedSubject.next(true);
      }),
      catchError(err => {
        this.clearAuthState();
        this.isInitializedSubject.next(true);
        return of(false);
      })
    );
  }

  // Ensure refreshAccessToken signature matches call
  refreshAccessToken(token?: string | null): Observable<AuthResponse> {
    const refreshTokenToUse = token ?? this.refreshTokenSubject.value; // Use provided or current subject value

    if (!refreshTokenToUse) {
      return throwError(() => new Error('No refresh token available for refreshAccessToken call'));
    }
    if (typeof refreshTokenToUse !== 'string' || refreshTokenToUse.trim() === '') {
      console.error('Invalid refresh token format:', refreshTokenToUse);
      this.clearAuthState();
      return throwError(() => new Error('Invalid refresh token format'));
    }
    
    // Using token property to match backend expectations
    const request = { token: refreshTokenToUse };
    
    return this.http.post<AuthResponse>(`${this.API_URL}/refresh`, request)
      .pipe(
        tap(response => {
          this.handleAuthResponse(response);
        }),
        catchError(error => {
          console.error('Token refresh HTTP call failed:', error);
          if (error.status === 400 || error.status === 401) { // 400/401 usually means invalid refresh token
            console.log('Clearing auth state due to invalid refresh token.');
            this.clearAuthState();
          }
          return throwError(() => error);
        })
      );
  }

  // Reads from storage but DOES NOT update state subjects
  private readAuthStateFromStorage(): { accessToken: string | null, refreshToken: string | null, csrfToken: string | null, user: User | null } {
    if (!isPlatformBrowser(this.platformId)) {
      return { accessToken: null, refreshToken: null, csrfToken: null, user: null };
    }
    try {
      const accessToken: string | null = localStorage.getItem('accessToken');
      const refreshToken: string | null = localStorage.getItem('refreshToken');
      const csrfToken: string | null = localStorage.getItem('csrfToken');
      const activeGroupId = localStorage.getItem('activeGroupId');
      if (activeGroupId) {
        this.activeGroupIdSubject.next(parseInt(activeGroupId, 10));
      }
      const userJson: string | null = localStorage.getItem('user');
      const user: User | null = userJson ? JSON.parse(userJson) as User : null;

      return { accessToken, refreshToken, csrfToken, user };
    } catch (error) {
      console.error('Error reading auth state from localStorage:', error);
      // Clear potentially corrupted storage
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('csrfToken');
      localStorage.removeItem('user');
      return { accessToken: null, refreshToken: null, csrfToken: null, user: null };
    }
  }

  // Get user profile
  getUserProfile(): Observable<User> {
    return this.http.get<User>(`${this.API_URL}/profile`);
  }

  /**
   * Request a password reset email.
   */
  forgotPassword(request: ForgotPasswordRequest): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.API_URL}/forgot-password`, request).pipe(
      tap(() => console.log('Forgot password request sent')),
      catchError(error => {
        console.error('Forgot password request failed:', error);
        return throwError(() => error);
      })
    );
  }

  // Verify reset token
  verifyResetToken(token: string): Observable<{ valid: boolean }> {
    return this.http.post<{ valid: boolean }>(`${this.API_URL}/verify-reset-token`, { token });
  }

  /**
   * Reset the password using a token.
   */
  resetPassword(request: ResetPasswordRequest): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.API_URL}/reset-password`, request).pipe(
      tap(() => console.log('Password reset successful')),
      catchError((error) => {
        const typedError = error as HttpErrorResponse;
        console.error('Password reset failed:', typedError);
        return throwError(() => typedError);
      })
    );
  }

  /**
   * Validate a CSRF token.
   */
  validateCsrfToken(csrfToken: string): Observable<{ valid: boolean }> {
    return this.http.post<{ valid: boolean }>(`${this.API_URL}/validate-csrf`, { csrfToken }).pipe(
      tap(response => console.log('CSRF token validation result:', response)),
      catchError(error => {
        console.error('CSRF token validation failed:', error);
        return of({ valid: false });
      })
    );
  }

  // Verify email
  verifyEmail(token: string, email: string): Observable<VerificationResponse> {
    if (!token) {
      return throwError(() => new Error('Verification token is required'));
    }
    
    if (!email) {
      return throwError(() => new Error('Email is required for verification'));
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

  /**
   * Change the current user's password.
   */
  changePassword(request: PasswordChangeRequest): Observable<void> {
    return this.http.post<void>(`${this.API_URL}/profile/change-password`, request).pipe(
      tap(() => console.log('Password changed successfully')),
      catchError((error) => {
        const typedError = error as HttpErrorResponse;
        console.error('Password change failed:', typedError);
        return throwError(() => typedError);
      })
    );
  }

  // Private helper methods
  private handleAuthResponse(response: AuthResponse): void {
    console.log('Handling auth response (updating subjects and storage)');
    if (!response.user || !response.accessToken || !response.refreshToken) {
      console.error('Invalid auth response in handleAuthResponse:', response);
      this.clearAuthState(); // Clear state if response is invalid
      throw new Error('Invalid auth response: missing required data');
    }
    
    // Update subjects first
    this.currentUserSubject.next(response.user);
    this.accessTokenSubject.next(response.accessToken);
    this.refreshTokenSubject.next(response.refreshToken);
    this.csrfTokenSubject.next(response.csrfToken);
    
    // Then save to storage
    if (isPlatformBrowser(this.platformId)) {
      try {
        this.saveAuthStateToStorage(response);
        console.log('Auth state saved to storage by handleAuthResponse');
      } catch (error) {
        console.error('Error saving auth state to storage in handleAuthResponse:', error);
        // Don't re-throw, but state might be inconsistent
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
        // Handle potentially null/undefined csrfToken
        localStorage.setItem('csrfToken', authResponse.csrfToken || ''); // Save empty string if null/undefined

        // Save debug info if available (development only)
        if (authResponse.debugInfo) {
          localStorage.setItem('authDebugInfo', JSON.stringify(authResponse.debugInfo));
        }
      } catch (error) {
        console.error('Error saving to localStorage:', error);
        // Clear any partial state
        this.clearAuthState();
        throw error;
      }
    }
  }

  /**
   * Clears all authentication tokens and user data from subjects and storage.
   */
  private clearAuthState(): void {
    this.currentUserSubject.next(null);
    this.accessTokenSubject.next(null);
    this.refreshTokenSubject.next(null);
    this.csrfTokenSubject.next(null);
    this.activeGroupIdSubject.next(null);
    
    // Clear permissions
    this.userPermissions = [];
    this.permissionCache.clear();
    
    // Check for browser environment before accessing localStorage
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('user');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('csrfToken');
      localStorage.removeItem('activeGroupId');
    }
  }

  // Delete account
  deleteAccount(): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/delete-account`).pipe(
      tap(() => {
        // Clear auth state on successful account deletion
        this.clearAuthState();
      }),
      catchError((error) => {
        const typedError = error as HttpErrorResponse;
        console.error('Error deleting account:', typedError);
        return throwError(() => typedError);
      })
    );
  }

  /**
   * Check the current authentication status
   * Used during app initialization to determine if user is already authenticated
   * @returns Observable of AuthStatus containing authentication state and user if authenticated
   */
  checkAuthStatus(): Observable<AuthStatus> {
    if (!isPlatformBrowser(this.platformId)) {
      return of({ isAuthenticated: false, user: null });
    }

    // Use current in-memory state first
    if (this.isAuthenticated && this.currentUser) {
      return of({ isAuthenticated: true, user: this.currentUser });
    }

    // If not in memory, check storage but DON'T validate here
    const stored = this.readAuthStateFromStorage();
    if (stored.accessToken && stored.user) {
        // If data is in storage, we assume it *might* be valid, but return current (null) state.
        // The APP_INITIALIZER should have handled validation/refresh.
        // If called *after* init, a component should trigger getUserProfile or similar
        // based on the potentially null currentUser$. Return the current (likely null) state for now.
         return of({ isAuthenticated: !!this.accessToken && !!this.currentUser, user: this.currentUser });
    }
    
    // If nothing in memory or storage, definitely not authenticated
    return of({ isAuthenticated: false, user: null });
  }

  /**
   * Logs the user out by clearing auth state and navigating to login.
   */
  logout(): Observable<void> {
    const refreshToken = this.refreshTokenSubject.value;
    
    // Clear local state immediately
    this.clearAuthState();
    
    // Navigate to login page
    this.router.navigate(['/login']);

    // Call the backend logout endpoint if a refresh token existed
    if (refreshToken) {
      return this.http.post<void>(`${this.API_URL}/logout`, { token: refreshToken }).pipe(
        catchError(err => {
          console.error('Logout API call failed, but local state is cleared:', err);
          // Don't block logout if API call fails, just log error
          return of(undefined); 
        })
      );
    } else {
      // If no refresh token, nothing to invalidate on backend
      return of(undefined); 
    }
  }

  /**
   * Log in a user.
   */
  login(credentials: UserLogin): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.API_URL}/login`, credentials).pipe(
      tap(response => {
        this.handleAuthResponse(response);
      }),
      catchError((error) => {
        const typedError = error as HttpErrorResponse;
        console.error('Login failed:', typedError);
        this.clearAuthState(); // Clear state on login failure
        return throwError(() => typedError);
      })
    );
  }
  
  /**
   * Register a new user.
   */
  register(userData: UserRegistration): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.API_URL}/register`, userData).pipe(
      tap(response => {
        this.handleAuthResponse(response);
      }),
      catchError((error: HttpErrorResponse) => {
        console.error('Registration failed:', error);
        return throwError(() => error);
      })
    );
  }
  
  /**
   * Refreshes the authentication state from storage.
   * Reads stored tokens and user data and updates the state subjects.
   */
  refreshAuthStateFromStorage(): void {
    const storedState = this.readAuthStateFromStorage();
    if (storedState.accessToken && storedState.user) {
      this.accessTokenSubject.next(storedState.accessToken);
      this.refreshTokenSubject.next(storedState.refreshToken);
      this.csrfTokenSubject.next(storedState.csrfToken);
      this.currentUserSubject.next(storedState.user);
    }
  }
}