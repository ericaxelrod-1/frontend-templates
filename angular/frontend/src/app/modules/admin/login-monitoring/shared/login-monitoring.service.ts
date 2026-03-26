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
  SecurityAlertsFilters,
  PatternDetectionFilters,
  PaginatedResponse 
} from './login-monitoring.models';
import { PatternSummary, PatternSummaryResponse, TimeFilter } from '../../../../models/pattern-summary.interface';

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
    page = 0,
    pageSize = 10,
    sortBy = 'createdAt',
    sortDirection = 'desc'
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

  // Pattern Detection API - UNIFIED APPROACH with Pagination Support
  getPatterns(
    filters: PatternDetectionFilters = {},
    page = 0,
    pageSize = 10,
    sortBy = 'detectionTimestamp',
    sortDirection = 'desc'
  ): Observable<PaginatedResponse<Pattern>> {
    let url = `${this.apiUrl}/patterns?limit=${pageSize}&offset=${page * pageSize}`;
    
    // Add sorting parameters
    url += `&sortBy=${sortBy}&sortDirection=${sortDirection}`;
    
    console.log('[DEBUG] Pattern service URL before filters:', url);
    console.log('[DEBUG] Pattern service parameters:', { page, pageSize, sortBy, sortDirection, filters });
    
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
    if (filters.dateFrom) {
      url += `&dateFrom=${filters.dateFrom.toISOString()}`;
    }
    if (filters.dateTo) {
      url += `&dateTo=${filters.dateTo.toISOString()}`;
    }
    if (filters.search) {
      url += `&search=${encodeURIComponent(filters.search)}`;
    }
    
    console.log('[DEBUG] Final patterns URL:', url);
    console.log('[DEBUG] Making HTTP request for patterns...');
    
    return this.http.get<{items: any[], total: number}>(url)
      .pipe(
        map(response => ({
          items: (response.items || []).map(pattern => this.transformDetectedPattern(pattern)),
          total: response.total || 0,
          page: page,
          pageSize: pageSize
        })),
        catchError(this.handleError)
      );
  }

  // DEPRECATED METHODS - Kept for backward compatibility during transition
  detectPatterns(): Observable<Pattern[]> {
    // Redirect to unified method and extract items only
    return this.getPatterns({}, 0, 50).pipe(
      map(response => response.items)
    );
  }

  loadRealTimePatterns(): Observable<Pattern[]> {
    // Redirect to unified method with active status filter and extract items only
    return this.getPatterns({ status: 'active' }, 0, 50).pipe(
      map(response => response.items)
    );
  }

  loadHistoricalPatterns(): Observable<Pattern[]> {
    // Redirect to unified method and extract items only
    return this.getPatterns({}, 0, 50).pipe(
      map(response => response.items)
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

  // Pattern Summary API for Dashboard Tiles
  getPatternSummary(timeFilter?: TimeFilter): Observable<PatternSummary[]> {
    let url = `${this.apiUrl}/patterns/summary`;
    const params: string[] = [];

    if (timeFilter) {
      if (timeFilter.timeRange) {
        params.push(`timeRange=${timeFilter.timeRange}`);
      } else if (timeFilter.dateFrom && timeFilter.dateTo) {
        params.push(`dateFrom=${timeFilter.dateFrom.toISOString()}`);
        params.push(`dateTo=${timeFilter.dateTo.toISOString()}`);
      }
    }

    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }

    return this.http.get<PatternSummaryResponse[]>(url)
      .pipe(
        map(response => response.map(item => ({
          ...item,
          lastDetected: new Date(item.lastDetected)
        }))),
        catchError(this.handleError)
      );
  }

  // DEPRECATED METHOD - Replaced by unified getPatterns method
  getFilteredPatterns(
    filters: PatternDetectionFilters = {},
    page = 0,
    pageSize = 10,
    sortBy = 'detectionTimestamp',
    sortDirection = 'desc'
  ): Observable<Pattern[]> {
    // Redirect to unified method and extract items only
    return this.getPatterns(filters, page, pageSize, sortBy, sortDirection).pipe(
      map(response => response.items)
    );
  }

  // Security Alerts API - Fixed to use correct endpoint and handle paginated response
  getSecurityAlerts(
    filters: SecurityAlertsFilters = {},
    page = 0,
    pageSize = 10,
    sortBy = 'createdAt',
    sortDirection = 'desc'
  ): Observable<SecurityAlert[]> {
    let url = `${environment.apiUrl}/security-alerts/alerts?limit=${pageSize}&offset=${page * pageSize}`;
    
    // Add sorting parameters
    if (sortBy && sortDirection) {
      url += `&sortBy=${sortBy}&sortDirection=${sortDirection}`;
    }
    
    // Add filters based on backend investigation
    if (filters.status) {
      url += `&status=${encodeURIComponent(filters.status)}`;
    }
    
    if (filters.severity) {
      url += `&severity=${encodeURIComponent(filters.severity)}`;
    }
    
    if (filters.alertType) {
      url += `&alertType=${encodeURIComponent(filters.alertType)}`;
    }
    
    if (filters.search) {
      url += `&search=${encodeURIComponent(filters.search)}`;
    }
    
    if (filters.dateFrom) {
      const dateFrom = new Date(filters.dateFrom);
      url += `&dateFrom=${dateFrom.toISOString()}`;
    }
    
    if (filters.dateTo) {
      const dateTo = new Date(filters.dateTo);
      url += `&dateTo=${dateTo.toISOString()}`;
    }

    return this.http.get<{items: any[], total: number}>(url)
      .pipe(
        map(response => (response.items || []).map(alert => this.transformSecurityAlert(alert))),
        catchError(this.handleError)
      );
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
   * Transform backend SecurityAlert to frontend SecurityAlert interface
   * Adds legacy field mappings for template compatibility
   */
  private transformSecurityAlert(backendAlert: any): SecurityAlert {
    return {
      ...backendAlert,
      // Legacy field mappings for template compatibility
      type: backendAlert.alertType,
      timestamp: backendAlert.createdAt ? new Date(backendAlert.createdAt) : new Date(),
      details: backendAlert.alertData ? JSON.parse(backendAlert.alertData) : null,
      // Ensure dates are Date objects
      createdAt: new Date(backendAlert.createdAt),
      updatedAt: new Date(backendAlert.updatedAt),
      acknowledgedAt: backendAlert.acknowledgedAt ? new Date(backendAlert.acknowledgedAt) : undefined,
      resolvedAt: backendAlert.resolvedAt ? new Date(backendAlert.resolvedAt) : undefined,
      expiresAt: backendAlert.expiresAt ? new Date(backendAlert.expiresAt) : undefined,
    };
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
      expanded: backendPattern.expanded || false,
      evidence: backendPattern.evidence // CRITICAL FIX: Include evidence property for grouping and metadata
    };
  }

  private handleError(error: HttpErrorResponse): Observable<never> {
    console.error('Login Monitoring API Error:', error);
    return throwError(() => error);
  }
} 