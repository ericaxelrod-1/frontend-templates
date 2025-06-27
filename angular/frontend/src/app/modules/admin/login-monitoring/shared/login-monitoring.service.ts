import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../environments/environment';
import { 
  LoginAttempt, 
  Statistics, 
  Pattern, 
  IPReputation, 
  SecurityAlert, 
  LoginMonitoringFilters,
  PaginatedResponse 
} from './login-monitoring.models';

@Injectable({
  providedIn: 'root'
})
export class LoginMonitoringService {
  private apiUrl = `${environment.apiUrl}/login-monitoring`;

  constructor(private http: HttpClient) {}

  // Statistics API
  getStatistics(): Observable<Statistics> {
    return this.http.get<Statistics>(`${this.apiUrl}/stats`)
      .pipe(catchError(this.handleError));
  }

  // Login Attempts API
  getRecentAttempts(
    filters: LoginMonitoringFilters = {},
    page: number = 0,
    pageSize: number = 10,
    sortBy: string = 'createdAt',
    sortDirection: string = 'desc'
  ): Observable<PaginatedResponse<LoginAttempt>> {
    let url = `${this.apiUrl}/attempts/recent?limit=${pageSize}&offset=${page * pageSize}`;
    
    // Add sorting parameters
    if (sortBy && sortDirection) {
      url += `&sortBy=${sortBy}&sortDirection=${sortDirection}`;
    }
    
    // Add filters
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
      const dateFrom = new Date(filters.dateFrom);
      url += `&dateFrom=${dateFrom.toISOString()}`;
    }
    
    if (filters.dateTo) {
      const dateTo = new Date(filters.dateTo);
      url += `&dateTo=${dateTo.toISOString()}`;
    }

    return this.http.get<PaginatedResponse<LoginAttempt>>(url)
      .pipe(catchError(this.handleError));
  }

  // Pattern Detection API
  detectPatterns(): Observable<Pattern[]> {
    return this.http.get<any[]>(`${this.apiUrl}/patterns/detect`)
      .pipe(
        map(patterns => patterns.map(pattern => this.transformDetectedPattern(pattern))),
        catchError(this.handleError)
      );
  }

  loadRealTimePatterns(): Observable<Pattern[]> {
    return this.http.get<any[]>(`${this.apiUrl}/patterns/real-time`)
      .pipe(
        map(patterns => patterns.map(pattern => this.transformDetectedPattern(pattern))),
        catchError(this.handleError)
      );
  }

  loadHistoricalPatterns(): Observable<Pattern[]> {
    return this.http.get<any[]>(`${this.apiUrl}/patterns/historical`)
      .pipe(
        map(patterns => patterns.map(pattern => this.transformDetectedPattern(pattern))),
        catchError(this.handleError)
      );
  }

  createTestPattern(patternType: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/patterns/test/${patternType}`, {})
      .pipe(catchError(this.handleError));
  }

  clearTestData(): Observable<any> {
    return this.http.delete(`${this.apiUrl}/patterns/test-data`)
      .pipe(catchError(this.handleError));
  }

  // Security Alerts API - Fixed to use correct endpoint
  getSecurityAlerts(): Observable<SecurityAlert[]> {
    return this.http.get<SecurityAlert[]>(`${environment.apiUrl}/security-alerts/alerts`)
      .pipe(catchError(this.handleError));
  }

  acknowledgeAlert(alertId: string): Observable<SecurityAlert> {
    return this.http.post<SecurityAlert>(`${environment.apiUrl}/security-alerts/alerts/${alertId}/acknowledge`, {})
      .pipe(catchError(this.handleError));
  }

  resolveAlert(alertId: string): Observable<SecurityAlert> {
    return this.http.post<SecurityAlert>(`${environment.apiUrl}/security-alerts/alerts/${alertId}/resolve`, {})
      .pipe(catchError(this.handleError));
  }

  dismissAlert(alertId: string): Observable<SecurityAlert> {
    return this.http.post<SecurityAlert>(`${environment.apiUrl}/security-alerts/alerts/${alertId}/dismiss`, {})
      .pipe(catchError(this.handleError));
  }

  sendTestAlert(): Observable<any> {
    return this.http.post(`${this.apiUrl}/alert/test`, {
      message: 'Test alert from UI',
      severity: 'medium'
    })
      .pipe(catchError(this.handleError));
  }

  // IP Reputation API
  getIPReputation(ipAddress: string): Observable<IPReputation> {
    return this.http.get<IPReputation>(`${this.apiUrl}/ip/${encodeURIComponent(ipAddress)}`)
      .pipe(catchError(this.handleError));
  }

  blockIP(ipAddress: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/ip/${encodeURIComponent(ipAddress)}/block`, {})
      .pipe(catchError(this.handleError));
  }

  unblockIP(ipAddress: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/ip/${encodeURIComponent(ipAddress)}/unblock`, {})
      .pipe(catchError(this.handleError));
  }

  /**
   * Transform backend DetectedPattern to frontend Pattern interface
   * Extracts IP addresses and emails from evidence data and backend fields
   */
  private transformDetectedPattern(backendPattern: any): Pattern {
    // Extract IP addresses from multiple possible sources
    let ipAddresses: string[] = [];
    
    // From the new backend ipAddresses field (if available)
    if (backendPattern.ipAddresses && Array.isArray(backendPattern.ipAddresses)) {
      ipAddresses = backendPattern.ipAddresses;
    } 
    // From evidence.ips (distributed attacks, IP hopping)
    else if (backendPattern.evidence?.ips && Array.isArray(backendPattern.evidence.ips)) {
      ipAddresses = backendPattern.evidence.ips;
    }
    // From evidence.ipAddress (single IP in evidence)
    else if (backendPattern.evidence?.ipAddress) {
      ipAddresses = [backendPattern.evidence.ipAddress];
    }
    // From top-level ipAddress field (backwards compatibility)
    else if (backendPattern.ipAddress) {
      ipAddresses = [backendPattern.ipAddress];
    }
    
    // Extract emails from multiple possible sources
    let emails: string[] = [];
    
    // From the new backend emails field (if available)
    if (backendPattern.emails && Array.isArray(backendPattern.emails)) {
      emails = backendPattern.emails;
    }
    // From evidence.emails (multiple emails)
    else if (backendPattern.evidence?.emails && Array.isArray(backendPattern.evidence.emails)) {
      emails = backendPattern.evidence.emails;
    }
    // From evidence.email (single email in evidence)
    else if (backendPattern.evidence?.email) {
      emails = [backendPattern.evidence.email];
    }
    // From top-level email field (backwards compatibility)
    else if (backendPattern.email) {
      emails = [backendPattern.email];
    }

    // Transform to frontend Pattern interface
    return {
      id: backendPattern.id || `${backendPattern.type}_${Date.now()}`,
      type: backendPattern.type,
      severity: backendPattern.severity,
      details: backendPattern.details,
      timestamp: new Date(backendPattern.timestamp),
      ipAddresses: ipAddresses, // Always an array
      email: emails.length > 0 ? emails[0] : undefined, // First email for backwards compatibility
      expanded: backendPattern.expanded || false
    };
  }

  private handleError(error: HttpErrorResponse): Observable<never> {
    console.error('Login Monitoring API Error:', error);
    return throwError(() => error);
  }
} 