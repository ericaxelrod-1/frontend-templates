import { Injectable } from '@angular/core';
import { Action, Selector, State, StateContext } from '@ngxs/store';
import { Navigate } from '@ngxs/router-plugin';
import { AuthService } from '../../core/services';
import { User } from '../../models';
import { catchError, tap } from 'rxjs/operators';
import { throwError } from 'rxjs';

// Auth actions
export namespace AuthActions {
  export class Login {
    static readonly type = '[Auth] Login';
    constructor(public email: string, public password: string) {}
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
      public lastName?: string
    ) {}
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
}

// Auth state model
export interface AuthStateModel {
  user: User | null;
  isAuthenticated: boolean;
  error: string | null;
  loading: boolean;
  passwordResetSuccess: boolean;
  forgotPasswordSuccess: boolean;
}

// Default state
const defaults: AuthStateModel = {
  user: null,
  isAuthenticated: false,
  error: null,
  loading: false,
  passwordResetSuccess: false,
  forgotPasswordSuccess: false
};

@State<AuthStateModel>({
  name: 'auth',
  defaults
})
@Injectable()
export class AuthState {
  constructor(private authService: AuthService) {}

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

  @Action(AuthActions.Login)
  login(ctx: StateContext<AuthStateModel>, action: AuthActions.Login) {
    ctx.patchState({ loading: true, error: null });
    
    return this.authService.login({
      email: action.email,
      password: action.password
    }).pipe(
      tap(response => {
        ctx.dispatch(new AuthActions.LoginSuccess(response.user));
      }),
      catchError(error => {
        const message = error?.error?.message || 'Login failed. Please try again.';
        ctx.dispatch(new AuthActions.LoginFailure(message));
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
    return ctx.dispatch(new Navigate(['/']));
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
    ctx.patchState({ loading: true, error: null });
    
    return this.authService.register({
      email: action.email,
      password: action.password,
      firstName: action.firstName,
      lastName: action.lastName
    }).pipe(
      tap(response => {
        ctx.dispatch(new AuthActions.LoginSuccess(response.user));
      }),
      catchError(error => {
        const message = error?.error?.message || 'Registration failed. Please try again.';
        ctx.dispatch(new AuthActions.LoginFailure(message));
        return throwError(() => error);
      })
    );
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
    ctx.patchState({ loading: true });
    
    return this.authService.logout().pipe(
      tap(() => {
        ctx.setState(defaults);
        return ctx.dispatch(new Navigate(['/login']));
      }),
      catchError(() => {
        // Even if the API call fails, we still clear the local state
        ctx.setState(defaults);
        return ctx.dispatch(new Navigate(['/login']));
      })
    );
  }

  @Action(AuthActions.GetProfile)
  getProfile(ctx: StateContext<AuthStateModel>) {
    // Only fetch if authenticated
    const state = ctx.getState();
    if (!state.isAuthenticated) {
      return;
    }
    
    return this.authService.getUserProfile().pipe(
      tap(user => {
        ctx.patchState({ user });
      }),
      catchError(error => {
        if (error?.status === 401) {
          // If unauthorized, log out
          ctx.dispatch(new AuthActions.Logout());
        }
        return throwError(() => error);
      })
    );
  }
} 