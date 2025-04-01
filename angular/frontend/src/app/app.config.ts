import { ApplicationConfig, importProvidersFrom, isDevMode, APP_INITIALIZER } from '@angular/core';
import { provideRouter, withPreloading, PreloadAllModules, withDebugTracing } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { NgxsModule } from '@ngxs/store';
import { NgxsRouterPluginModule } from '@ngxs/router-plugin';
import { NgxsFormPluginModule } from '@ngxs/form-plugin';
import { NgxsReduxDevtoolsPluginModule } from '@ngxs/devtools-plugin';
import { provideHttpClient, withInterceptorsFromDi, withFetch } from '@angular/common/http';
import { httpInterceptorProviders } from './core/interceptors';
import { AuthState } from './store';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { AppConfigService } from './core/services/app-config.service';
import { LoggerService } from './services/logging/logger.service';
import { environment } from '../environments/environment';
import { AuthService } from './core/services/auth.service';
import { Store } from '@ngxs/store';
import { AuthActions } from './store/auth/auth.state';
import { firstValueFrom } from 'rxjs';
import { CaptchaService } from './core/services/captcha.service';

// Function to initialize the logger
export function initializeLogging(logger: LoggerService) {
  return () => {
    return Promise.resolve();
  };
}

// Function to initialize authentication state
export function initializeAuth(authService: AuthService, store: Store) {
  return async () => {
    try {
      console.log('App initializing - checking auth state');
      
      // Force a refresh of the auth state from localStorage
      authService.refreshAuthStateFromStorage();
      
      if (authService.isAuthenticated && authService.currentUser) {
        console.log('Auth tokens found, setting initial state and fetching profile');
        
        // First set the initial state from local storage - this is important to avoid UI flicker
        await firstValueFrom(store.dispatch(
          new AuthActions.SetInitialAuthState(authService.currentUser, true)
        ));
        
        // Then fetch the latest profile
        return await firstValueFrom(store.dispatch(new AuthActions.AppInitialize()));
      } else {
        console.log('No auth tokens found, skipping initialization');
      }
    } catch (error) {
      console.error('Error during auth initialization:', error);
    }
    return Promise.resolve();
  };
}

// HMR preservation function
export function preserveStateForHMR() {
  return environment.hmr && isDevMode();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(
      routes,
      withPreloading(PreloadAllModules),
      withDebugTracing()
    ),
    provideClientHydration(),
    provideAnimations(),
    provideHttpClient(withInterceptorsFromDi(), withFetch()),
    httpInterceptorProviders,
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
    AppConfigService,
    LoggerService,
    CaptchaService,
    {
      provide: APP_INITIALIZER,
      useFactory: initializeLogging,
      deps: [LoggerService],
      multi: true
    },
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAuth,
      deps: [AuthService, Store],
      multi: true
    },
    importProvidersFrom(
      NgxsModule.forRoot(
        [AuthState], 
        { 
          developmentMode: !environment.production,
          selectorOptions: {
            suppressErrors: false,
            injectContainerState: false
          }
        }
      ),
      NgxsRouterPluginModule.forRoot(),
      NgxsFormPluginModule.forRoot(),
      NgxsReduxDevtoolsPluginModule.forRoot()
    )
  ]
};
