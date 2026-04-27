import { Injectable } from '@angular/core';
import { State, Action, StateContext, Selector } from '@ngxs/store';
import { PrivacyActions } from './privacy.actions';
import { PrivacyService, PrivacyPreferences, PrivacyTicket } from '../../features/privacy/privacy.service';
import { tap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

export interface PrivacyStateModel {
  preferences: PrivacyPreferences | null;
  activeTickets: PrivacyTicket[];
  isLoading: boolean;
  error: string | null;
}

@State<PrivacyStateModel>({
  name: 'privacy',
  defaults: {
    preferences: null,
    activeTickets: [],
    isLoading: false,
    error: null
  }
})
@Injectable()
export class PrivacyState {
  constructor(private privacyService: PrivacyService) {}

  @Selector()
  static getPreferences(state: PrivacyStateModel) {
    return state.preferences;
  }

  @Selector()
  static getActiveTickets(state: PrivacyStateModel) {
    return state.activeTickets;
  }

  @Selector()
  static isLoading(state: PrivacyStateModel) {
    return state.isLoading;
  }

  @Selector()
  static getError(state: PrivacyStateModel) {
    return state.error;
  }

  @Action(PrivacyActions.FetchPreferences)
  fetchPreferences(ctx: StateContext<PrivacyStateModel>) {
    ctx.patchState({ isLoading: true, error: null });
    return this.privacyService.getPreferences().pipe(
      tap((preferences) => {
        ctx.patchState({ preferences, isLoading: false });
      }),
      catchError((error) => {
        ctx.patchState({ error: error.message, isLoading: false });
        return of(error);
      })
    );
  }

  @Action(PrivacyActions.UpdateMarketingConsent)
  updateMarketingConsent(ctx: StateContext<PrivacyStateModel>, { consent }: PrivacyActions.UpdateMarketingConsent) {
    ctx.patchState({ isLoading: true });
    return this.privacyService.updateMarketingConsent(consent).pipe(
      tap(() => {
        const state = ctx.getState();
        if (state.preferences) {
          ctx.patchState({
            preferences: { ...state.preferences, marketingConsent: consent },
            isLoading: false
          });
        }
      }),
      catchError((error) => {
        ctx.patchState({ error: error.message, isLoading: false });
        return of(error);
      })
    );
  }

  @Action(PrivacyActions.UpdateDoNotSell)
  updateDoNotSell(ctx: StateContext<PrivacyStateModel>, { doNotSell }: PrivacyActions.UpdateDoNotSell) {
    ctx.patchState({ isLoading: true });
    return this.privacyService.updateDoNotSell(doNotSell).pipe(
      tap(() => {
        const state = ctx.getState();
        if (state.preferences) {
          ctx.patchState({
            preferences: { ...state.preferences, doNotSell: doNotSell },
            isLoading: false
          });
        }
      }),
      catchError((error) => {
        ctx.patchState({ error: error.message, isLoading: false });
        return of(error);
      })
    );
  }

  @Action(PrivacyActions.FetchActiveTickets)
  fetchActiveTickets(ctx: StateContext<PrivacyStateModel>) {
    ctx.patchState({ isLoading: true, error: null });
    return this.privacyService.getTickets().pipe(
      tap((tickets) => {
        ctx.patchState({ activeTickets: tickets, isLoading: false });
      }),
      catchError((error) => {
        ctx.patchState({ error: error.message, isLoading: false });
        return of(error);
      })
    );
  }

  @Action(PrivacyActions.CreateTicket)
  createTicket(ctx: StateContext<PrivacyStateModel>, { requestType, description, additionalData }: PrivacyActions.CreateTicket) {
    ctx.patchState({ isLoading: true });
    return this.privacyService.createTicket(requestType, description, additionalData).pipe(
      tap((newTicket) => {
        const state = ctx.getState();
        ctx.patchState({
          activeTickets: [...state.activeTickets, newTicket],
          isLoading: false
        });
      }),
      catchError((error) => {
        ctx.patchState({ error: error.message, isLoading: false });
        return of(error);
      })
    );
  }

  @Action(PrivacyActions.ExportData)
  exportData(ctx: StateContext<PrivacyStateModel>) {
    ctx.patchState({ isLoading: true });
    return this.privacyService.exportData().pipe(
      tap(() => {
        ctx.patchState({ isLoading: false });
      }),
      catchError((error) => {
        ctx.patchState({ error: error.message, isLoading: false });
        return of(error);
      })
    );
  }

  @Action(PrivacyActions.DeleteAccount)
  deleteAccount(ctx: StateContext<PrivacyStateModel>) {
    ctx.patchState({ isLoading: true });
    return this.privacyService.deleteAccount().pipe(
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
