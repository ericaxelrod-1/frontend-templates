import { Injectable } from '@angular/core';
import { Action, Selector, State, StateContext } from '@ngxs/store';
import { GroupsState as GroupsStateModel } from '../../models/groups.model';
import { GroupsActions } from './groups.actions';
import { catchError, tap } from 'rxjs/operators';
import { GroupService } from '../../core/services/group.service';

@State<GroupsStateModel>({
  name: 'groups',
  defaults: {
    groups: [],
    selectedGroup: null,
    loading: false,
    error: null
  }
})
@Injectable()
export class GroupsState {
  constructor(private groupService: GroupService) {}

  @Selector()
  static groups(state: GroupsStateModel) {
    return state.groups;
  }

  @Selector()
  static selectedGroup(state: GroupsStateModel) {
    return state.selectedGroup;
  }

  @Selector()
  static loading(state: GroupsStateModel) {
    return state.loading;
  }

  @Selector()
  static error(state: GroupsStateModel) {
    return state.error;
  }

  @Action(GroupsActions.LoadGroups)
  loadGroups(ctx: StateContext<GroupsStateModel>, action: GroupsActions.LoadGroups) {
    ctx.patchState({ loading: true });
    
    return this.groupService.getGroups(action.payload).pipe(
      tap((groups) => {
        ctx.patchState({
          groups,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to load groups'
        });
        throw error;
      })
    );
  }

  @Action(GroupsActions.LoadGroup)
  loadGroup(ctx: StateContext<GroupsStateModel>, action: GroupsActions.LoadGroup) {
    ctx.patchState({ loading: true });
    
    return this.groupService.getGroup(action.id).pipe(
      tap((group) => {
        ctx.patchState({
          selectedGroup: group,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to load group'
        });
        throw error;
      })
    );
  }

  @Action(GroupsActions.CreateGroup)
  createGroup(ctx: StateContext<GroupsStateModel>, action: GroupsActions.CreateGroup) {
    ctx.patchState({ loading: true });
    
    return this.groupService.createGroup(action.payload).pipe(
      tap((group) => {
        const state = ctx.getState();
        ctx.patchState({
          groups: [...state.groups, group],
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to create group'
        });
        throw error;
      })
    );
  }

  @Action(GroupsActions.UpdateGroup)
  updateGroup(ctx: StateContext<GroupsStateModel>, action: GroupsActions.UpdateGroup) {
    ctx.patchState({ loading: true });
    
    return this.groupService.updateGroup(action.payload).pipe(
      tap((updatedGroup) => {
        const state = ctx.getState();
        const groups = state.groups.map(group => 
          group.id === updatedGroup.id ? updatedGroup : group
        );
        
        ctx.patchState({
          groups,
          selectedGroup: state.selectedGroup?.id === updatedGroup.id ? updatedGroup : state.selectedGroup,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to update group'
        });
        throw error;
      })
    );
  }

  @Action(GroupsActions.DeleteGroup)
  deleteGroup(ctx: StateContext<GroupsStateModel>, action: GroupsActions.DeleteGroup) {
    ctx.patchState({ loading: true });
    
    return this.groupService.deleteGroup(action.id).pipe(
      tap(() => {
        const state = ctx.getState();
        ctx.patchState({
          groups: state.groups.filter(group => group.id !== action.id),
          selectedGroup: state.selectedGroup?.id === action.id ? null : state.selectedGroup,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to delete group'
        });
        throw error;
      })
    );
  }

  @Action(GroupsActions.AddMember)
  addMember(ctx: StateContext<GroupsStateModel>, action: GroupsActions.AddMember) {
    ctx.patchState({ loading: true });
    
    return this.groupService.addMember(action.payload).pipe(
      tap((updatedGroup) => {
        const state = ctx.getState();
        const groups = state.groups.map(group => 
          group.id === updatedGroup.id ? updatedGroup : group
        );
        
        ctx.patchState({
          groups,
          selectedGroup: state.selectedGroup?.id === updatedGroup.id ? updatedGroup : state.selectedGroup,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to add member to group'
        });
        throw error;
      })
    );
  }

  @Action(GroupsActions.RemoveMember)
  removeMember(ctx: StateContext<GroupsStateModel>, action: GroupsActions.RemoveMember) {
    ctx.patchState({ loading: true });
    
    return this.groupService.removeMember(action.groupId, action.userId).pipe(
      tap((updatedGroup) => {
        const state = ctx.getState();
        const groups = state.groups.map(group => 
          group.id === updatedGroup.id ? updatedGroup : group
        );
        
        ctx.patchState({
          groups,
          selectedGroup: state.selectedGroup?.id === updatedGroup.id ? updatedGroup : state.selectedGroup,
          loading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({
          loading: false,
          error: error.message || 'Failed to remove member from group'
        });
        throw error;
      })
    );
  }

  @Action(GroupsActions.SetSelectedGroup)
  setSelectedGroup(ctx: StateContext<GroupsStateModel>, action: GroupsActions.SetSelectedGroup) {
    ctx.patchState({ selectedGroup: action.payload });
  }
} 