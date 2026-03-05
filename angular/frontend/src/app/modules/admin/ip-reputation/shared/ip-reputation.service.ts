import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../../../environments/environment';
import { IPReputation } from '../../login-monitoring/shared/login-monitoring.models';

@Injectable({
  providedIn: 'root'
})
export class IpReputationService {
  private apiUrl = `${environment.apiUrl}/ip-reputation`;

  constructor(private http: HttpClient) {}

  /**
   * Get IP reputation and history with aggregated data
   */
  getIPReputation(ipAddress: string): Observable<any> {
    const url = `${this.apiUrl}/reputation/${encodeURIComponent(ipAddress)}`;

    console.log('[DEBUG] IP reputation service URL:', url);
    console.log('[DEBUG] Making HTTP request for IP reputation...');
    
    return this.http.get<any>(url)
      .pipe(catchError(this.handleError));
  }

  /**
   * Block an IP address
   */
  blockIP(ipAddress: string): Observable<any> {
    const url = `${this.apiUrl}/reputation/block`;
    
    console.log('[DEBUG] Blocking IP:', ipAddress);
    
    return this.http.post<any>(url, { ipAddress })
      .pipe(catchError(this.handleError));
  }

  /**
   * Unblock an IP address
   */
  unblockIP(ipAddress: string): Observable<any> {
    const url = `${this.apiUrl}/reputation/unblock`;
    
    console.log('[DEBUG] Unblocking IP:', ipAddress);
    
    return this.http.post<any>(url, { ipAddress })
      .pipe(catchError(this.handleError));
  }

  /**
   * Handle HTTP errors
   */
  private handleError(error: any): Observable<never> {
    console.error('IP Reputation Service Error:', error);
    throw error;
  }
} 