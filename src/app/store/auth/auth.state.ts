import { Injectable } from '@angular/core';
import { Action, Selector, State, StateContext } from '@ngxs/store';
import { AuthState as AuthStateModel } from '../../models/auth.model';
import { AuthActions } from './auth.actions';
import { catchError, tap } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';

@State<AuthStateModel>({
  name: 'auth',
  defaults: {
    user: null,
    token: null,
    isAuthenticated: false,
    loading: false,
    error: null
  }
})
@Injectable()
export class AuthState {
  constructor(private authService: AuthService) {}

  @Selector()
  static user(state: AuthStateModel) {
    return state.user;
  }

  @Selector()
  static token(state: AuthStateModel) {
    return state.token;
  }

  @Selector()
  static isAuthenticated(state: AuthStateModel) {
    return state.isAuthenticated;
  }

  @Selector()
  static loading(state: AuthStateModel) {
    return state.loading;
  }

  @Selector()
  static error(state: AuthStateModel) {
    return state.error;
  }

  @Action(AuthActions.Login)
  login(ctx: StateContext<AuthStateModel>, action: AuthActions.Login) {
    ctx.patchState({ loading: true, error: null });
    
    return this.authService.login(action.payload).pipe(
      tap((response) => {
        ctx.patchState({
          user: response.user,
          token: response.token,
          isAuthenticated: true,
          loading: false,
          error: null
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Authentication failed'
        });
        throw error;
      })
    );
  }

  @Action(AuthActions.Register)
  register(ctx: StateContext<AuthStateModel>, action: AuthActions.Register) {
    ctx.patchState({ loading: true, error: null });
    
    return this.authService.register(action.payload).pipe(
      tap((response) => {
        ctx.patchState({
          user: response.user,
          token: response.token,
          isAuthenticated: true,
          loading: false,
          error: null
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Registration failed'
        });
        throw error;
      })
    );
  }

  @Action(AuthActions.Logout)
  logout(ctx: StateContext<AuthStateModel>) {
    return this.authService.logout().pipe(
      tap(() => {
        ctx.setState({
          user: null,
          token: null,
          isAuthenticated: false,
          loading: false,
          error: null
        });
      })
    );
  }

  @Action(AuthActions.LoadUser)
  loadUser(ctx: StateContext<AuthStateModel>) {
    ctx.patchState({ loading: true });
    
    return this.authService.getCurrentUser().pipe(
      tap((user) => {
        ctx.patchState({
          user,
          isAuthenticated: true,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          user: null,
          token: null,
          isAuthenticated: false,
          loading: false,
          error: error.message || 'Failed to load user'
        });
        throw error;
      })
    );
  }
} 