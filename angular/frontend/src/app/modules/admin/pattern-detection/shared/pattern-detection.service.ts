import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../environments/environment';
import { 
  Pattern, 
  PatternDetectionFilters, 
  PaginatedResponse 
} from '../../login-monitoring/shared/login-monitoring.models';
import { TimeFilter, PatternSummary } from '../../../../models/pattern-summary.interface';

@Injectable({
  providedIn: 'root'
})
export class PatternDetectionService {
  private apiUrl = `${environment.apiUrl}/pattern-detection`;

  constructor(private http: HttpClient) {}

  /**
   * Get patterns with filtering, sorting, and pagination
   */
  getPatterns(
    filters: PatternDetectionFilters = {},
    page: number = 0,
    pageSize: number = 10,
    sortBy: string = 'detectionTimestamp',
    sortDirection: string = 'desc'
  ): Observable<PaginatedResponse<Pattern>> {
    let url = `${this.apiUrl}/patterns?limit=${pageSize}&offset=${page * pageSize}`;
    
    // Add sorting parameters
    url += `&sortBy=${sortBy}&sortDirection=${sortDirection}`;
    
    // Add filter parameters
    if (filters.status) {
      url += `&status=${encodeURIComponent(filters.status)}`;
    }
    
    if (filters.patternType) {
      url += `&patternType=${encodeURIComponent(filters.patternType)}`;
    }
    
    if (filters.severity) {
      url += `&severity=${encodeURIComponent(filters.severity)}`;
    }
    
    if (filters.ipAddress) {
      url += `&ipAddress=${encodeURIComponent(filters.ipAddress)}`;
    }
    
    if (filters.search) {
      url += `&search=${encodeURIComponent(filters.search)}`;
    }
    
    if (filters.dateFrom) {
      url += `&dateFrom=${filters.dateFrom.toISOString()}`;
    }
    
    if (filters.dateTo) {
      url += `&dateTo=${filters.dateTo.toISOString()}`;
    }

    console.log('[DEBUG] Pattern service URL before filters:', this.apiUrl);
    console.log('[DEBUG] Pattern service parameters:', {
      page, pageSize, sortBy, sortDirection, filters
    });
    console.log('[DEBUG] Final patterns URL:', url);
    
    return this.http.get<PaginatedResponse<Pattern>>(url)
      .pipe(
        catchError(this.handleError),
        map(response => {
          console.log('[DEBUG] Making HTTP request for patterns...');
          return response;
        })
      );
  }

  /**
   * Get pattern summary for dashboard tiles
   */
  getPatternSummary(timeFilter: TimeFilter): Observable<PatternSummary[]> {
    let url = `${this.apiUrl}/patterns/summary`;
    
    if (timeFilter.timeRange) {
      url += `?timeRange=${timeFilter.timeRange}`;
    }
    
    if (timeFilter.dateFrom) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}dateFrom=${timeFilter.dateFrom.toISOString()}`;
    }
    
    if (timeFilter.dateTo) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}dateTo=${timeFilter.dateTo.toISOString()}`;
    }

    return this.http.get<PatternSummary[]>(url)
      .pipe(catchError(this.handleError));
  }

  /**
   * Create test pattern for testing purposes
   */
  createTestPattern(patternType: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/patterns/test/${patternType}`, {})
      .pipe(catchError(this.handleError));
  }

  /**
   * Clear all test data
   */
  clearTestData(): Observable<any> {
    return this.http.delete(`${this.apiUrl}/patterns/test-data`)
      .pipe(catchError(this.handleError));
  }

  /**
   * Handle HTTP errors
   */
  private handleError(error: any): Observable<never> {
    console.error('Pattern Detection Service Error:', error);
    throw error;
  }
} 