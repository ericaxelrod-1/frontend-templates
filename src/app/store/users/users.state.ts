import { Injectable } from '@angular/core';
import { Action, Selector, State, StateContext } from '@ngxs/store';
import { UsersState as UsersStateModel } from '../../models/users.model';
import { UsersActions } from './users.actions';
import { catchError, tap } from 'rxjs/operators';
import { UserService } from '../../core/services/user.service';

@State<UsersStateModel>({
  name: 'users',
  defaults: {
    users: [],
    selectedUser: null,
    loading: false,
    error: null
  }
})
@Injectable()
export class UsersState {
  constructor(private userService: UserService) {}

  @Selector()
  static users(state: UsersStateModel) {
    return state.users;
  }

  @Selector()
  static selectedUser(state: UsersStateModel) {
    return state.selectedUser;
  }

  @Selector()
  static loading(state: UsersStateModel) {
    return state.loading;
  }

  @Selector()
  static error(state: UsersStateModel) {
    return state.error;
  }

  @Action(UsersActions.LoadUsers)
  loadUsers(ctx: StateContext<UsersStateModel>, action: UsersActions.LoadUsers) {
    ctx.patchState({ loading: true });
    
    return this.userService.getUsers(action.payload).pipe(
      tap((users) => {
        ctx.patchState({
          users,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to load users'
        });
        throw error;
      })
    );
  }

  @Action(UsersActions.LoadUser)
  loadUser(ctx: StateContext<UsersStateModel>, action: UsersActions.LoadUser) {
    ctx.patchState({ loading: true });
    
    return this.userService.getUser(action.id).pipe(
      tap((user) => {
        ctx.patchState({
          selectedUser: user,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to load user'
        });
        throw error;
      })
    );
  }

  @Action(UsersActions.CreateUser)
  createUser(ctx: StateContext<UsersStateModel>, action: UsersActions.CreateUser) {
    ctx.patchState({ loading: true });
    
    return this.userService.createUser(action.payload).pipe(
      tap((user) => {
        const state = ctx.getState();
        ctx.patchState({
          users: [...state.users, user],
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to create user'
        });
        throw error;
      })
    );
  }

  @Action(UsersActions.UpdateUser)
  updateUser(ctx: StateContext<UsersStateModel>, action: UsersActions.UpdateUser) {
    ctx.patchState({ loading: true });
    
    return this.userService.updateUser(action.payload).pipe(
      tap((updatedUser) => {
        const state = ctx.getState();
        const users = state.users.map(user => 
          user.id === updatedUser.id ? updatedUser : user
        );
        
        ctx.patchState({
          users,
          selectedUser: state.selectedUser?.id === updatedUser.id ? updatedUser : state.selectedUser,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to update user'
        });
        throw error;
      })
    );
  }

  @Action(UsersActions.DeleteUser)
  deleteUser(ctx: StateContext<UsersStateModel>, action: UsersActions.DeleteUser) {
    ctx.patchState({ loading: true });
    
    return this.userService.deleteUser(action.id).pipe(
      tap(() => {
        const state = ctx.getState();
        ctx.patchState({
          users: state.users.filter(user => user.id !== action.id),
          selectedUser: state.selectedUser?.id === action.id ? null : state.selectedUser,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to delete user'
        });
        throw error;
      })
    );
  }

  @Action(UsersActions.SetSelectedUser)
  setSelectedUser(ctx: StateContext<UsersStateModel>, action: UsersActions.SetSelectedUser) {
    ctx.patchState({ selectedUser: action.payload });
  }
} 