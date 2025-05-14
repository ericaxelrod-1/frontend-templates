import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { AuthInterceptor } from './auth.interceptor';
import { CaseTransformInterceptor } from './case-transform.interceptor';

export const httpInterceptorProviders = [
  // The order matters! Case transform should happen before auth interceptor
  { provide: HTTP_INTERCEPTORS, useClass: CaseTransformInterceptor, multi: true },
  { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }
]; 