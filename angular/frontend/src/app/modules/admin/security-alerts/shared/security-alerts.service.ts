import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../environments/environment';
import { 
  SecurityAlert, 
  SecurityAlertsFilters, 
  PaginatedResponse 
} from '../../login-monitoring/shared/login-monitoring.models';

@Injectable({
  providedIn: 'root'
})
export class SecurityAlertsService {
  private apiUrl = `${environment.apiUrl}/security-alerts`;

  constructor(private http: HttpClient) {}

  /**
   * Get security alerts with filtering, sorting, and pagination
   */
  getSecurityAlerts(
    filters: SecurityAlertsFilters = {},
    page = 0,
    pageSize = 10,
    sortBy = 'createdAt',
    sortDirection = 'desc'
  ): Observable<PaginatedResponse<SecurityAlert>> {
    let url = `${this.apiUrl}/alerts?limit=${pageSize}&offset=${page * pageSize}`;
    
    // Add sorting parameters
    url += `&sortBy=${sortBy}&sortDirection=${sortDirection}`;
    
    // Add filter parameters
    if (filters.severity) {
      url += `&severity=${encodeURIComponent(filters.severity)}`;
    }
    
    if (filters.status) {
      url += `&status=${encodeURIComponent(filters.status)}`;
    }
    
    if (filters.alertType) {
      url += `&alertType=${encodeURIComponent(filters.alertType)}`;
    }
    
    if (filters.dateFrom) {
      url += `&dateFrom=${filters.dateFrom.toISOString()}`;
    }
    
    if (filters.dateTo) {
      url += `&dateTo=${filters.dateTo.toISOString()}`;
    }

    console.log('[DEBUG] Security alerts service URL before filters:', this.apiUrl);
    console.log('[DEBUG] Security alerts service parameters:', {
      page, pageSize, sortBy, sortDirection, filters
    });
    console.log('[DEBUG] Final security alerts URL:', url);
    
    return this.http.get<PaginatedResponse<SecurityAlert>>(url)
      .pipe(
        catchError(this.handleError),
        map(response => {
          console.log('[DEBUG] Making HTTP request for security alerts...');
          return response;
        })
      );
  }

  /**
   * Resolve a security alert
   */
  resolveAlert(alertId: string): Observable<any> {
    return this.http.put(`${this.apiUrl}/alerts/${alertId}/resolve`, {})
      .pipe(catchError(this.handleError));
  }

  /**
   * Dismiss a security alert
   */
  dismissAlert(alertId: string): Observable<any> {
    return this.http.put(`${this.apiUrl}/alerts/${alertId}/dismiss`, {})
      .pipe(catchError(this.handleError));
  }

  /**
   * Acknowledge a security alert
   */
  acknowledgeAlert(alertId: string): Observable<any> {
    console.log('[DEBUG] Acknowledging alert:', alertId);
    
    return this.http.put(`${this.apiUrl}/alerts/${alertId}/acknowledge`, {})
      .pipe(catchError(this.handleError));
  }

  /**
   * Send a test alert
   */
  sendTestAlert(): Observable<any> {
    const url = `${this.apiUrl}/alerts/test`;
    
    console.log('[DEBUG] Sending test alert');
    
    return this.http.post<any>(url, {})
      .pipe(catchError(this.handleError));
  }

  /**
   * Handle HTTP errors
   */
  private handleError(error: any): Observable<never> {
    console.error('Security Alerts Service Error:', error);
    throw error;
  }
} 