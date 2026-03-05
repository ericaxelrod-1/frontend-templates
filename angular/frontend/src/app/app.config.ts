import { ApplicationConfig, importProvidersFrom, isDevMode, APP_INITIALIZER } from '@angular/core';
import { provideRouter, withPreloading, withDebugTracing, PreloadingStrategy, Route } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { NgxsModule, Store } from '@ngxs/store';
import { NgxsRouterPluginModule } from '@ngxs/router-plugin';
import { NgxsFormPluginModule } from '@ngxs/form-plugin';
import { NgxsReduxDevtoolsPluginModule } from '@ngxs/devtools-plugin';
import { provideHttpClient, withInterceptorsFromDi, withFetch } from '@angular/common/http';
import { httpInterceptorProviders } from './core/interceptors';
import { AuthState, AuthActions } from './store';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { AppConfigService } from './core/services/app-config.service';
import { LoggerService } from './services/logging/logger.service';
import { environment } from '../environments/environment';
import { AuthService } from './core/services/auth.service';
import { firstValueFrom, Observable, of } from 'rxjs';
import { CaptchaService } from './core/services/captcha.service';
import { AdvancedCaptchaService } from './core/services/advanced-captcha.service';
import { RolesConstantsService } from './core/constants/roles';
import { Injectable } from '@angular/core';

// Custom selective preloading strategy - only preload high-priority routes
@Injectable()
class SelectivePreloadingStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    // Only preload dashboard and profile routes (most commonly accessed)
    const shouldPreload = route.path === 'dashboard' || route.path === 'profile';
    return shouldPreload ? load() : of(null);
  }
}

// Function to initialize the logger
export function initializeLogging() {
  return () => {
    return Promise.resolve();
  };
}

// Function to initialize auth and permissions
export function initializeAuth(authService: AuthService, store: Store) {
  return async () => {
    console.log('APP_INITIALIZER: Starting auth initialization...');
    
    // First, initialize the auth state (refresh tokens if available)
    const authInitialized = await firstValueFrom(authService.initializeAuthState());
    console.log(`APP_INITIALIZER: Auth service initialized. Authenticated: ${authInitialized}`);
    
    // Then dispatch AppInitialize to load permissions if authenticated
    if (authInitialized) {
      console.log('APP_INITIALIZER: Dispatching AppInitialize action to load permissions...');
      await firstValueFrom(store.dispatch(new AuthActions.AppInitialize()));
      console.log('APP_INITIALIZER: AppInitialize action completed');
    }
    
    console.log('APP_INITIALIZER: Auth initialization complete');
    return true;
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
      withPreloading(SelectivePreloadingStrategy),
      ...(isDevMode() ? [withDebugTracing()] : [])
    ),
    provideClientHydration(),
    provideAnimations(),
    provideHttpClient(withInterceptorsFromDi(), withFetch()),
    httpInterceptorProviders,
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
    SelectivePreloadingStrategy,
    AppConfigService,
    LoggerService,
    CaptchaService,
    AdvancedCaptchaService,
    RolesConstantsService,
    {
      provide: APP_INITIALIZER,
      useFactory: initializeLogging,
      deps: [],
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
            suppressErrors: !isDevMode(),
            injectContainerState: false
          }
        }
      ),
      NgxsRouterPluginModule.forRoot(),
      NgxsFormPluginModule.forRoot(),
      ...(isDevMode() ? [NgxsReduxDevtoolsPluginModule.forRoot()] : [])
    )
  ]
};
