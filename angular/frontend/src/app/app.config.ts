import { ApplicationConfig, importProvidersFrom } from '@angular/core';
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
import { APP_INITIALIZER } from '@angular/core';

// Function to initialize the logger
export function initializeLogging(logger: LoggerService) {
  return () => {
    return Promise.resolve();
  };
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
    {
      provide: APP_INITIALIZER,
      useFactory: initializeLogging,
      deps: [LoggerService],
      multi: true
    },
    importProvidersFrom(
      NgxsModule.forRoot([AuthState]),
      NgxsRouterPluginModule.forRoot(),
      NgxsFormPluginModule.forRoot(),
      NgxsReduxDevtoolsPluginModule.forRoot()
    )
  ]
};
