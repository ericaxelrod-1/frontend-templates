import { Injectable } from '@angular/core';
import { State, Action, StateContext, Selector } from '@ngxs/store';
import { SystemHealthActions } from './system-health.actions';
import {
  SystemHealthService,
  SystemHealth,
  ClearTempResult,
} from '../../core/services/system-health.service';
import { tap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

export interface SystemHealthStateModel {
  health: SystemHealth | null;
  isLoading: boolean;
  error: string | null;
  /** Outcome of the last manual purge. Kept so the operator sees what it did. */
  cleanup: ClearTempResult | null;
}

@State<SystemHealthStateModel>({
  name: 'systemHealth',
  defaults: {
    health: null,
    isLoading: false,
    error: null,
    cleanup: null,
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
    // 'Unknown', not 'Healthy': before the first fetch the Sentinel genuinely
    // does not know, and a dashboard that opens on a green badge is a
    // dashboard that can report a healthy system while the check is failing.
    return state.health?.status ?? 'Unknown';
  }

  @Selector()
  static isLoading(state: SystemHealthStateModel) {
    return state.isLoading;
  }

  @Selector()
  static error(state: SystemHealthStateModel) {
    return state.error;
  }

  @Selector()
  static cleanup(state: SystemHealthStateModel) {
    return state.cleanup;
  }

  @Action(SystemHealthActions.FetchHealth)
  fetchHealth(ctx: StateContext<SystemHealthStateModel>) {
    ctx.patchState({ isLoading: true, error: null });
    return this.healthService.getHealth().pipe(
      tap((health) => {
        ctx.patchState({ health, isLoading: false });
      }),
      catchError((error) => {
        // Surfaced in the UI. A failed health check is not a healthy system.
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
    ctx.patchState({ isLoading: true, error: null, cleanup: null });
    return this.healthService.clearTempFiles().pipe(
      tap((cleanup) => {
        ctx.patchState({ isLoading: false, cleanup });
      }),
      catchError((error) => {
        ctx.patchState({ error: error.message, isLoading: false });
        return of(error);
      })
    );
  }
}