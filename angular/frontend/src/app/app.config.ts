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
import { firstValueFrom } from 'rxjs';
import { CaptchaService } from './core/services/captcha.service';
import { AdvancedCaptchaService } from './core/services/advanced-captcha.service';
import { RolesConstantsService } from './core/constants/roles';

// Function to initialize the logger
export function initializeLogging() {
  return () => {
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
      useFactory: (authService: AuthService) => () => authService.initializeAuthState(),
      deps: [AuthService],
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
