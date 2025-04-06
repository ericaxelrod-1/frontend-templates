import { Injectable } from '@angular/core';
import { Action, Selector, State, StateContext } from '@ngxs/store';
import { Navigate } from '@ngxs/router-plugin';
import { AuthService } from '../../core/services';
import { User, UserRegistration } from '../../models';
import { catchError, tap } from 'rxjs/operators';
import { throwError, of } from 'rxjs';

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
  verificationSuccess: false
};

@State<AuthStateModel>({
  name: 'auth',
  defaults
})
@Injectable()
export class AuthState {
  constructor(private authService: AuthService) {
  }

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

  @Action(AuthActions.Login)
  login(ctx: StateContext<AuthStateModel>, action: AuthActions.Login) {
    ctx.patchState({ loading: true, error: null });
    
    console.log('AuthState: Login action dispatched');
    
    return this.authService.login({
      email: action.email,
      password: action.password,
      recaptchaToken: action.recaptchaToken
    }).pipe(
      tap(response => {
        console.log('AuthState: Login successful');
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
      user: action.user,
      isAuthenticated: true,
      loading: false,
      error: null
    });
    return ctx.dispatch(new Navigate(['/app/dashboard']));
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
    return this.authService.forgotPassword(action.email).pipe(
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
    console.log('AuthState: Logout action dispatched');
    ctx.patchState({ loading: true });
    
    return this.authService.logout().pipe(
      tap((response) => {
        console.log('AuthState: Logout successful:', response);
        ctx.setState(defaults);
      }),
      catchError(error => {
        console.error('AuthState: Error in logout:', error);
        // Even if there's an error, clear state anyway for security
        ctx.setState(defaults);
        return of(null); // Return observable that completes successfully
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
    
    // Redirect to home page after successful verification
    return ctx.dispatch(new Navigate(['/app/dashboard']));
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
    // Only continue if we have stored authentication data
    if (!this.authService.isAuthenticated) {
      console.log('AppInitialize: No authentication data found');
      return;
    }
    
    console.log('AppInitialize: Authentication data found, fetching user profile');
    
    return this.authService.getUserProfile().pipe(
      tap(user => {
        console.log('AppInitialize: User profile fetched successfully');
        ctx.patchState({
          user,
          isAuthenticated: true
        });
      }),
      catchError(error => {
        console.error('AppInitialize: Error fetching user profile:', error);
        // If we get a 401, clear the state
        ctx.setState(defaults);
        return throwError(() => error);
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
} 