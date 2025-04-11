import { BrowserModule } from '@angular/platform-browser';
import { NgModule, APP_INITIALIZER } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
import { NgxsModule } from '@ngxs/store';
import { NgxsRouterPluginModule } from '@ngxs/router-plugin';
import { NgxsFormPluginModule } from '@ngxs/form-plugin';
import { NgxsReduxDevtoolsPluginModule } from '@ngxs/devtools-plugin';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { SharedModule } from './shared/shared.module';
import { AuthState } from './store/auth/auth.state';
import { environment } from '../environments/environment';

// Import Services & Interceptors directly
import { AuthService } from './core/services/auth.service';
import { PermissionService } from './core/services/permission.service';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';
// ErrorInterceptor removed as it doesn't exist
import { PermissionInterceptor } from './core/interceptors/permission.interceptor';

import { firstValueFrom } from 'rxjs';

// APP_INITIALIZER factory function for Auth State (with proactive refresh)
export function initializeAppFactory(authService: AuthService): () => Promise<boolean> {
  console.log('APP_INITIALIZER (Auth): Configuring...');
  return () => {
    console.log('APP_INITIALIZER (Auth): Running initializeAuthState...');
    const promise = firstValueFrom(authService.initializeAuthState());
    promise.then(result => console.log(`APP_INITIALIZER (Auth): Initialization complete. Restored/Refreshed: ${result}`))
           .catch(err => console.error('APP_INITIALIZER (Auth): Initialization failed:', err));
    return promise;
  };
}

@NgModule({
  declarations: [
    AppComponent
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    AppRoutingModule,
    SharedModule,
    NgxsModule.forRoot([AuthState], {
      developmentMode: !environment.production
    }),
    NgxsRouterPluginModule.forRoot(),
    NgxsFormPluginModule.forRoot(),
    NgxsReduxDevtoolsPluginModule.forRoot({
      disabled: environment.production
    }),
  ],
  providers: [
    AuthService,
    PermissionService,
    // Auth Initializer (runs first)
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAppFactory,
      deps: [AuthService],
      multi: true
    },
    // Provide HTTP Interceptors
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    // ErrorInterceptor removed
    { provide: HTTP_INTERCEPTORS, useClass: PermissionInterceptor, multi: true },
  ],
  bootstrap: [AppComponent]
})
export class AppModule { } 