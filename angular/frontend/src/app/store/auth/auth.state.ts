import { Injectable } from '@angular/core';
import { Action, Selector, State, StateContext } from '@ngxs/store';
import { Navigate } from '@ngxs/router-plugin';
import { AuthService, AuthStatus } from '../../core/services/auth.service';
import { PermissionService } from '../../core/services/permission.service';
import { User, UserRegistration } from '../../models';
import { catchError, tap, switchMap } from 'rxjs/operators';
import { throwError, of } from 'rxjs';
import { RolesConstantsService } from '../../core/constants/roles';

// Auth actions
export namespace AuthActions {
  export class Login {
    static readonly type = '[Auth] Login';
    constructor(
      public email: string, 
      public password: string,
      public recaptchaToken?: string
    ) {}
  }

  export class LoginSuccess {
    static readonly type = '[Auth] Login Success';
    constructor(public user: User) {}
  }

  export class LoginFailure {
    static readonly type = '[Auth] Login Failure';
    constructor(public error: string) {}
  }

  export class Register {
    static readonly type = '[Auth] Register';
    constructor(
      public email: string, 
      public password: string, 
      public firstName?: string, 
      public lastName?: string,
      public privacyConsent?: boolean
    ) {}
  }

  export class RegisterSuccess {
    static readonly type = '[Auth] Register Success';
    constructor(public message: string) {}
  }

  export class RegisterFailure {
    static readonly type = '[Auth] Register Failure';
    constructor(public error: string) {}
  }

  export class ForgotPassword {
    static readonly type = '[Auth] Forgot Password';
    constructor(public email: string) {}
  }

  export class ForgotPasswordSuccess {
    static readonly type = '[Auth] Forgot Password Success';
  }

  export class ForgotPasswordFailure {
    static readonly type = '[Auth] Forgot Password Failure';
    constructor(public error: string) {}
  }

  export class ResetPassword {
    static readonly type = '[Auth] Reset Password';
    constructor(
      public token: string,
      public password: string,
      public passwordConfirmation: string
    ) {}
  }

  export class ResetPasswordSuccess {
    static readonly type = '[Auth] Reset Password Success';
  }

  export class ResetPasswordFailure {
    static readonly type = '[Auth] Reset Password Failure';
    constructor(public error: string) {}
  }

  export class Logout {
    static readonly type = '[Auth] Logout';
  }

  export class GetProfile {
    static readonly type = '[Auth] Get Profile';
  }

  export class VerifyEmail {
    static readonly type = '[Auth] Verify Email';
    constructor(public token: string, public email: string) {}
  }

  export class VerifyEmailSuccess {
    static readonly type = '[Auth] Verify Email Success';
    constructor(public user: User) {}
  }

  export class VerifyEmailFailure {
    static readonly type = '[Auth] Verify Email Failure';
    constructor(public error: string) {}
  }

  export class AppInitialize {
    static readonly type = '[Auth] App Initialize';
  }

  export class SetInitialAuthState {
    static readonly type = '[Auth] Set Initial Auth State';
    constructor(public user: User, public isAuthenticated: boolean) {}
  }

  // New action for loading user permissions
  export class LoadUserPermissions {
    static readonly type = '[Auth] Load User Permissions';
  }
  
  export class LoadUserPermissionsSuccess {
    static readonly type = '[Auth] Load User Permissions Success';
    constructor(public permissions: string[]) {}
  }
  
  export class LoadUserPermissionsFailure {
    static readonly type = '[Auth] Load User Permissions Failure';
    constructor(public error: string) {}
  }

  // Add a new action for loading roles
  export class LoadRoles {
    static readonly type = '[Auth] Load Roles';
  }
  
  export class LoadRolesSuccess {
    static readonly type = '[Auth] Load Roles Success';
  }
  
  export class LoadRolesFailure {
    static readonly type = '[Auth] Load Roles Failure';
    constructor(public error: string) {}
  }
}

// Auth state model
export interface AuthStateModel {
  user: User | null;
  isAuthenticated: boolean;
  error: string | null;
  loading: boolean;
  passwordResetSuccess: boolean;
  forgotPasswordSuccess: boolean;
  registrationSuccess: boolean;
  verificationSuccess: boolean;
  permissions: string[]; // Added permissions array
  permissionsLoaded: boolean; // Track if permissions are loaded
  rolesLoaded: boolean; // Track if roles are loaded
}

// Default state
const defaults: AuthStateModel = {
  user: null,
  isAuthenticated: false,
  error: null,
  loading: false,
  passwordResetSuccess: false,
  forgotPasswordSuccess: false,
  registrationSuccess: false,
  verificationSuccess: false,
  permissions: [], // Initialize with empty array
  permissionsLoaded: false,
  rolesLoaded: false
};

@State<AuthStateModel>({
  name: 'auth',
  defaults
})
@Injectable()
export class AuthState {
  constructor(
    private authService: AuthService,
    private permissionService: PermissionService,
    private rolesService: RolesConstantsService
  ) {}

  @Selector()
  static user(state: AuthStateModel): User | null {
    return state.user;
  }

  @Selector()
  static isAuthenticated(state: AuthStateModel): boolean {
    return state.isAuthenticated;
  }

  @Selector()
  static error(state: AuthStateModel): string | null {
    return state.error;
  }

  @Selector()
  static loading(state: AuthStateModel): boolean {
    return state.loading;
  }

  @Selector()
  static passwordResetSuccess(state: AuthStateModel): boolean {
    return state.passwordResetSuccess;
  }

  @Selector()
  static forgotPasswordSuccess(state: AuthStateModel): boolean {
    return state.forgotPasswordSuccess;
  }

  @Selector()
  static registrationSuccess(state: AuthStateModel): boolean {
    return state.registrationSuccess;
  }

  @Selector()
  static verificationSuccess(state: AuthStateModel): boolean {
    return state.verificationSuccess;
  }

  @Selector()
  static permissions(state: AuthStateModel): string[] {
    return state.permissions;
  }

  @Selector()
  static permissionsLoaded(state: AuthStateModel): boolean {
    return state.permissionsLoaded;
  }

  @Selector()
  static hasPermission(state: AuthStateModel): (permission: string) => boolean {
    return (permission: string) => {
      if (!state.permissionsLoaded || !state.permissions.length) {
        return false;
      }
      return state.permissions.includes(permission);
    };
  }

  @Selector()
  static hasAnyPermission(state: AuthStateModel): (permissions: string[]) => boolean {
    return (permissions: string[]) => {
      if (!state.permissionsLoaded || !state.permissions.length) {
        return false;
      }
      return permissions.some(permission => state.permissions.includes(permission));
    };
  }

  @Selector()
  static hasAllPermissions(state: AuthStateModel): (permissions: string[]) => boolean {
    return (permissions: string[]) => {
      if (!state.permissionsLoaded || !state.permissions.length) {
        return false;
      }
      return permissions.every(permission => state.permissions.includes(permission));
    };
  }

  @Selector()
  static rolesLoaded(state: AuthStateModel): boolean {
    return state.rolesLoaded;
  }

  @Action(AuthActions.Login)
  login(ctx: StateContext<AuthStateModel>, action: AuthActions.Login) {
    ctx.patchState({ loading: true, error: null });
    
    return this.authService.login({
      email: action.email,
      password: action.password,
      recaptchaToken: action.recaptchaToken
    }).pipe(
      tap(response => {
        ctx.dispatch(new AuthActions.LoginSuccess(response.user));
      }),
      catchError(error => {
        console.error('AuthState: Login failed with error:', {
          status: error?.status,
          statusText: error?.statusText
        });
        
        // Build a descriptive error message
        let errorMessage = 'Login failed. Please try again.';
        
        if (error?.status === 401) {
          errorMessage = 'Invalid email or password. Please try again.';
        } else if (error?.status === 403) {
          errorMessage = 'Your account is locked. Please contact an administrator.';
        } else if (error?.error?.message) {
          errorMessage = error.error.message;
        }
        
        ctx.dispatch(new AuthActions.LoginFailure(errorMessage));
        return throwError(() => error);
      })
    );
  }

  @Action(AuthActions.LoginSuccess)
  loginSuccess(ctx: StateContext<AuthStateModel>, action: AuthActions.LoginSuccess) {
    ctx.patchState({
      loading: false,
      error: null,
      user: action.user,
      isAuthenticated: true
    });
    
    return this.rolesService.initialize().pipe(
      tap(() => {
        ctx.patchState({ rolesLoaded: true });
      }),
      switchMap(() => ctx.dispatch(new AuthActions.LoadUserPermissions())),
      switchMap(() => {
        return ctx.dispatch(new Navigate(['/app/dashboard']));
      }),
      catchError(error => {
        console.error('AuthState: Error in authentication sequence:', error);
        // Still consider auth successful even if roles/permissions loading fails
        // This prevents being stuck in a failed state
        return ctx.dispatch(new Navigate(['/app/dashboard']));
      })
    );
  }

  @Action(AuthActions.LoginFailure)
  loginFailure(ctx: StateContext<AuthStateModel>, action: AuthActions.LoginFailure) {
    ctx.patchState({
      loading: false,
      error: action.error
    });
  }

  @Action(AuthActions.Register)
  register(ctx: StateContext<AuthStateModel>, action: AuthActions.Register) {
    ctx.patchState({ loading: true, error: null, registrationSuccess: false });
    
    // Create registration data object
    const userData: UserRegistration = {
      email: action.email,
      password: action.password,
      firstName: action.firstName,
      lastName: action.lastName
    };
    
    // Add privacy consent if provided
    if (typeof action.privacyConsent !== 'undefined') {
      userData.privacyConsent = action.privacyConsent;
    }
    
    return this.authService.register(userData).pipe(
      tap(response => {
        if (response.requiresVerification) {
          ctx.dispatch(new AuthActions.RegisterSuccess('Registration successful! Please check your email to verify your account.'));
        } else {
          ctx.dispatch(new AuthActions.LoginSuccess(response.user));
        }
      }),
      catchError(error => {
        const message = error?.error?.message || 'Registration failed. Please try again.';
        ctx.dispatch(new AuthActions.RegisterFailure(message));
        return throwError(() => error);
      })
    );
  }

  @Action(AuthActions.RegisterSuccess)
  registerSuccess(ctx: StateContext<AuthStateModel>, action: AuthActions.RegisterSuccess) {
    ctx.patchState({
      loading: false,
      error: null,
      registrationSuccess: true
    });
  }

  @Action(AuthActions.RegisterFailure)
  registerFailure(ctx: StateContext<AuthStateModel>, action: AuthActions.RegisterFailure) {
    ctx.patchState({
      loading: false,
      error: action.error,
      registrationSuccess: false
    });
  }

  @Action(AuthActions.ForgotPassword)
  forgotPassword(ctx: StateContext<AuthStateModel>, action: AuthActions.ForgotPassword) {
    console.log('ForgotPassword action triggered with email:', action.email);
    ctx.patchState({ 
      loading: true, 
      error: null,
      forgotPasswordSuccess: false
    });
    
    console.log('Making HTTP request to:', `${this.authService['API_URL']}/forgot-password`);
    return this.authService.forgotPassword({ email: action.email }).pipe(
      tap(response => {
        console.log('ForgotPassword success response:', response);
        ctx.dispatch(new AuthActions.ForgotPasswordSuccess());
      }),
      catchError(error => {
        console.error('ForgotPassword error:', error);
        console.error('Error details:', {
          status: error.status,
          statusText: error.statusText,
          message: error?.error?.message || 'Unknown error',
          error: error.error
        });
        const message = error?.error?.message || 'Password reset request failed. Please try again.';
        ctx.dispatch(new AuthActions.ForgotPasswordFailure(message));
        return throwError(() => error);
      })
    );
  }

  @Action(AuthActions.ForgotPasswordSuccess)
  forgotPasswordSuccess(ctx: StateContext<AuthStateModel>) {
    ctx.patchState({
      loading: false,
      error: null,
      forgotPasswordSuccess: true
    });
  }

  @Action(AuthActions.ForgotPasswordFailure)
  forgotPasswordFailure(ctx: StateContext<AuthStateModel>, action: AuthActions.ForgotPasswordFailure) {
    ctx.patchState({
      loading: false,
      error: action.error,
      forgotPasswordSuccess: false
    });
  }

  @Action(AuthActions.ResetPassword)
  resetPassword(ctx: StateContext<AuthStateModel>, action: AuthActions.ResetPassword) {
    ctx.patchState({ 
      loading: true, 
      error: null,
      passwordResetSuccess: false
    });
    
    return this.authService.resetPassword({
      token: action.token,
      password: action.password,
      passwordConfirmation: action.passwordConfirmation
    }).pipe(
      tap(() => {
        ctx.dispatch(new AuthActions.ResetPasswordSuccess());
      }),
      catchError(error => {
        const message = error?.error?.message || 'Password reset failed. Please try again.';
        ctx.dispatch(new AuthActions.ResetPasswordFailure(message));
        return throwError(() => error);
      })
    );
  }

  @Action(AuthActions.ResetPasswordSuccess)
  resetPasswordSuccess(ctx: StateContext<AuthStateModel>) {
    ctx.patchState({
      loading: false,
      error: null,
      passwordResetSuccess: true
    });
    
    // After some time, redirect to login
    setTimeout(() => {
      ctx.dispatch(new Navigate(['/login']));
    }, 3000); // Wait 3 seconds before redirecting to allow user to see the success message
  }

  @Action(AuthActions.ResetPasswordFailure)
  resetPasswordFailure(ctx: StateContext<AuthStateModel>, action: AuthActions.ResetPasswordFailure) {
    ctx.patchState({
      loading: false,
      error: action.error,
      passwordResetSuccess: false
    });
  }

  @Action(AuthActions.Logout)
  logout(ctx: StateContext<AuthStateModel>) {
    ctx.patchState({ loading: true });
    
    // Reset roles when logging out
    this.rolesService.reset();
    
    return this.authService.logout().pipe(
      tap(() => {
        ctx.setState({
          ...defaults
        });
        return ctx.dispatch(new Navigate(['/login']));
      })
    );
  }

  @Action(AuthActions.GetProfile)
  getProfile(ctx: StateContext<AuthStateModel>) {
    const state = ctx.getState();
    
    // If user is already loaded, no need to fetch again
    if (state.user) {
      return;
    }
    
    return this.authService.getUserProfile().pipe(
      tap(user => {
        ctx.patchState({
          user,
          isAuthenticated: true
        });
      }),
      catchError(error => {
        // If we get a 401, logout the user
        if (error.status === 401) {
          ctx.dispatch(new AuthActions.Logout());
        }
        return throwError(() => error);
      })
    );
  }

  @Action(AuthActions.VerifyEmail)
  verifyEmail(ctx: StateContext<AuthStateModel>, action: AuthActions.VerifyEmail) {
    ctx.patchState({ 
      loading: true, 
      error: null,
      verificationSuccess: false
    });
    
    return this.authService.verifyEmail(action.token, action.email).pipe(
      tap(response => {
        ctx.dispatch(new AuthActions.VerifyEmailSuccess(response.user));
      }),
      catchError(error => {
        const message = error?.error?.message || 'Email verification failed. Please try again.';
        ctx.dispatch(new AuthActions.VerifyEmailFailure(message));
        return throwError(() => error);
      })
    );
  }

  @Action(AuthActions.VerifyEmailSuccess)
  verifyEmailSuccess(ctx: StateContext<AuthStateModel>, action: AuthActions.VerifyEmailSuccess) {
    ctx.patchState({
      loading: false,
      error: null,
      user: action.user,
      isAuthenticated: true,
      verificationSuccess: true
    });
    
    return this.rolesService.initialize().pipe(
      tap(() => {
        ctx.patchState({ rolesLoaded: true });
      }),
      switchMap(() => ctx.dispatch(new AuthActions.LoadUserPermissions())),
      switchMap(() => {
        return ctx.dispatch(new Navigate(['/app/dashboard']));
      }),
      catchError(error => {
        console.error('AuthState: Error in verification authentication sequence:', error);
        // Still consider auth successful even if roles/permissions loading fails
        return ctx.dispatch(new Navigate(['/app/dashboard']));
      })
    );
  }

  @Action(AuthActions.VerifyEmailFailure)
  verifyEmailFailure(ctx: StateContext<AuthStateModel>, action: AuthActions.VerifyEmailFailure) {
    ctx.patchState({
      loading: false,
      error: action.error,
      verificationSuccess: false
    });
  }

  @Action(AuthActions.AppInitialize)
  appInitialize(ctx: StateContext<AuthStateModel>) {
    return this.authService.checkAuthStatus().pipe(
      tap((status: AuthStatus) => {
        if (status.isAuthenticated && status.user) {
          ctx.dispatch(new AuthActions.SetInitialAuthState(status.user, true));
          
          // Use sequential loading for app initialization too
          this.rolesService.initialize().pipe(
            tap(() => {
              ctx.patchState({ rolesLoaded: true });
            }),
            switchMap(() => ctx.dispatch(new AuthActions.LoadUserPermissions())),
            catchError(error => {
              console.error('AuthState: Error loading roles/permissions during app init:', error);
              return of(null); // Allow app to continue even if role loading fails
            })
          ).subscribe();
        } else {
          ctx.patchState({
            isAuthenticated: false,
            user: null
          });
        }
      }),
      catchError(error => {
        console.error('Error checking auth status:', error);
        ctx.patchState({
          isAuthenticated: false,
          user: null
        });
        return of(null);
      })
    );
  }

  @Action(AuthActions.SetInitialAuthState)
  setInitialAuthState(ctx: StateContext<AuthStateModel>, action: AuthActions.SetInitialAuthState) {
    console.log('Setting initial auth state explicitly:', {
      isAuthenticated: action.isAuthenticated,
      hasUser: !!action.user
    });
    
    ctx.patchState({
      user: action.user,
      isAuthenticated: action.isAuthenticated
    });
  }

  @Action(AuthActions.LoadUserPermissions)
  loadUserPermissions(ctx: StateContext<AuthStateModel>) {
    return this.permissionService.loadUserPermissions().pipe(
      tap(permissions => {
        ctx.dispatch(new AuthActions.LoadUserPermissionsSuccess(permissions));
      }),
      catchError(error => {
        console.error('Error loading user permissions:', error);
        ctx.dispatch(new AuthActions.LoadUserPermissionsFailure('Failed to load permissions'));
        return of([]); // Return empty array on error
      })
    );
  }

  @Action(AuthActions.LoadUserPermissionsSuccess)
  loadUserPermissionsSuccess(ctx: StateContext<AuthStateModel>, action: AuthActions.LoadUserPermissionsSuccess) {
    ctx.patchState({
      permissions: action.permissions,
      permissionsLoaded: true
    });
  }

  @Action(AuthActions.LoadUserPermissionsFailure)
  loadUserPermissionsFailure(ctx: StateContext<AuthStateModel>, action: AuthActions.LoadUserPermissionsFailure) {
    ctx.patchState({
      error: action.error,
      permissionsLoaded: false
    });
  }

  @Action(AuthActions.LoadRoles)
  loadRoles(ctx: StateContext<AuthStateModel>) {
    // Only attempt to load roles if authenticated
    if (!ctx.getState().isAuthenticated) {
      return of(null);
    }
    
    return this.rolesService.initialize().pipe(
      tap(() => {
        ctx.dispatch(new AuthActions.LoadRolesSuccess());
      }),
      catchError(error => {
        console.error('Error loading roles:', error);
        ctx.dispatch(new AuthActions.LoadRolesFailure('Failed to load roles'));
        return of(null);
      })
    );
  }

  @Action(AuthActions.LoadRolesSuccess)
  loadRolesSuccess(ctx: StateContext<AuthStateModel>) {
    ctx.patchState({
      rolesLoaded: true
    });
  }

  @Action(AuthActions.LoadRolesFailure)
  loadRolesFailure(ctx: StateContext<AuthStateModel>, action: AuthActions.LoadRolesFailure) {
    ctx.patchState({
      error: action.error,
      rolesLoaded: false
    });
  }
} 