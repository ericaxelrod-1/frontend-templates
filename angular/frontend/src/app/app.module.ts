import { NgModule, APP_INITIALIZER } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HTTP_INTERCEPTORS, HttpClientModule } from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { SharedModule } from './shared/shared.module';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';
import { ErrorModule } from './features/errors/error.module';
import { AuthService } from './core/services/auth.service';
import { PermissionService } from './core/services/permission.service';

// Initialize permissions after authentication
export function initializePermissions(authService: AuthService, permissionService: PermissionService) {
  return () => {
    // Only load permissions if user is already authenticated (e.g., token in local storage)
    if (authService.currentUser) {
      return permissionService.loadUserPermissions().toPromise();
    }
    return Promise.resolve();
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
    ErrorModule
  ],
  providers: [
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true
    },
    {
      provide: APP_INITIALIZER,
      useFactory: initializePermissions,
      deps: [AuthService, PermissionService],
      multi: true
    }
  ],
  bootstrap: [AppComponent]
})
export class AppModule { } 