import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../environments/environment';
import { 
  LoginAttempt, 
  LoginMonitoringFilters, 
  Statistics,
  PaginatedResponse 
} from '../../login-monitoring/shared/login-monitoring.models';

@Injectable({
  providedIn: 'root'
})
export class LoginAttemptsService {
  private apiUrl = `${environment.apiUrl}/login-attempts`;

  constructor(private http: HttpClient) {}

  /**
   * Get recent login attempts with filtering, sorting, and pagination
   */
  getRecentAttempts(
    filters: LoginMonitoringFilters = {},
    page = 0,
    pageSize = 10,
    sortBy = 'createdAt',
    sortDirection = 'desc'
  ): Observable<PaginatedResponse<LoginAttempt>> {
    let url = `${this.apiUrl}/attempts?limit=${pageSize}&offset=${page * pageSize}`;
    
    // Add sorting parameters
    url += `&sortBy=${sortBy}&sortDirection=${sortDirection}`;
    
    // Add filter parameters
    if (filters.email) {
      url += `&email=${encodeURIComponent(filters.email)}`;
    }
    
    if (filters.ipAddress) {
      url += `&ipAddress=${encodeURIComponent(filters.ipAddress)}`;
    }
    
    if (filters.status) {
      url += `&status=${encodeURIComponent(filters.status)}`;
    }
    
    if (filters.dateFrom) {
      url += `&dateFrom=${filters.dateFrom.toISOString()}`;
    }
    
    if (filters.dateTo) {
      url += `&dateTo=${filters.dateTo.toISOString()}`;
    }

    console.log('[DEBUG] Login attempts service URL before filters:', this.apiUrl);
    console.log('[DEBUG] Login attempts service parameters:', {
      page, pageSize, sortBy, sortDirection, filters
    });
    console.log('[DEBUG] Final login attempts URL:', url);
    
    return this.http.get<PaginatedResponse<LoginAttempt>>(url)
      .pipe(
        catchError(this.handleError),
        map(response => {
          console.log('[DEBUG] Making HTTP request for login attempts...');
          return response;
        })
      );
  }

  /**
   * Get login statistics
   */
  getStatistics(days = 7): Observable<Statistics> {
    let url = `${this.apiUrl}/statistics`;
    
    if (days) {
      url += `?days=${days}`;
    }

    return this.http.get<Statistics>(url)
      .pipe(catchError(this.handleError));
  }

  /**
   * Handle HTTP errors
   */
  private handleError(error: any): Observable<never> {
    console.error('Login Attempts Service Error:', error);
    throw error;
  }
} 