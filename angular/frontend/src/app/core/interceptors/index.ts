import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { AuthInterceptor } from './auth.interceptor';
import { PermissionInterceptor } from './permission.interceptor';
import { GeoBlockInterceptor } from './geo-block.interceptor';
import { GroupContextInterceptor } from './group-context.interceptor';

export const httpInterceptorProviders = [
  { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
  { provide: HTTP_INTERCEPTORS, useClass: PermissionInterceptor, multi: true },
  { provide: HTTP_INTERCEPTORS, useClass: GeoBlockInterceptor, multi: true },
  { provide: HTTP_INTERCEPTORS, useClass: GroupContextInterceptor, multi: true }
];