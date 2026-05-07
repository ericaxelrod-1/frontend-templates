import { Injectable } from '@angular/core';
import { State, Action, StateContext, Selector } from '@ngxs/store';
import { SystemHealthActions } from './system-health.actions';
import { SystemHealthService, SystemHealth } from '../../core/services/system-health.service';
import { tap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

export interface SystemHealthStateModel {
  health: SystemHealth | null;
  isLoading: boolean;
  error: string | null;
}

@State<SystemHealthStateModel>({
  name: 'systemHealth',
  defaults: {
    health: null,
    isLoading: false,
    error: null
  }
})
@Injectable()
export class SystemHealthState {
  constructor(private healthService: SystemHealthService) {}

  @Selector()
  static getHealth(state: SystemHealthStateModel) {
    return state.health;
  }

  @Selector()
  static getStatus(state: SystemHealthStateModel) {
    return state.health?.status || 'Healthy';
  }

  @Selector()
  static isLoading(state: SystemHealthStateModel) {
    return state.isLoading;
  }

  @Action(SystemHealthActions.FetchHealth)
  fetchHealth(ctx: StateContext<SystemHealthStateModel>) {
    ctx.patchState({ isLoading: true, error: null });
    return this.healthService.getHealth().pipe(
      tap((health) => {
        ctx.patchState({ health, isLoading: false });
      }),
      catchError((error) => {
        ctx.patchState({ error: error.message, isLoading: false });
        return of(error);
      })
    );
  }

  @Action(SystemHealthActions.SetHealth)
  setHealth(ctx: StateContext<SystemHealthStateModel>, { health }: SystemHealthActions.SetHealth) {
    ctx.patchState({ health });
  }

  @Action(SystemHealthActions.ClearTempFiles)
  clearTempFiles(ctx: StateContext<SystemHealthStateModel>) {
    ctx.patchState({ isLoading: true });
    return this.healthService.clearTempFiles().pipe(
      tap(() => {
        ctx.patchState({ isLoading: false });
      }),
      catchError((error) => {
        ctx.patchState({ error: error.message, isLoading: false });
        return of(error);
      })
    );
  }
}
