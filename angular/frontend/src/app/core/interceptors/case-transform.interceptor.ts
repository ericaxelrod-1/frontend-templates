import { Injectable } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor,
  HttpResponse
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable()
export class CaseTransformInterceptor implements HttpInterceptor {
  constructor() {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(request).pipe(
      map((event: HttpEvent<any>) => {
        // Only transform HttpResponses from our API
        if (event instanceof HttpResponse && event.url?.includes(environment.apiUrl)) {
          // Create a new response with transformed body
          return event.clone({
            body: this.transformToFrontendFormat(event.body)
          });
        }
        
        return event;
      })
    );
  }

  /**
   * Transform an object or array from backend snake_case to frontend camelCase format
   * @param data The data to transform
   * @returns The transformed data with camelCase keys
   */
  private transformToFrontendFormat(data: any): any {
    if (!data) return data;
    
    // Handle arrays
    if (Array.isArray(data)) {
      return data.map(item => this.transformToFrontendFormat(item));
    }
    
    // Handle objects
    if (typeof data === 'object' && data !== null) {
      const result: any = {};
      
      Object.keys(data).forEach(key => {
        // Convert key from snake_case to camelCase
        const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        
        // Transform nested objects/arrays recursively
        result[camelKey] = this.transformToFrontendFormat(data[key]);
      });
      
      return result;
    }
    
    // Return primitive values as-is
    return data;
  }
} 