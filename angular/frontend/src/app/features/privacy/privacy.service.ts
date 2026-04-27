import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface PrivacyPreferences {
  marketingConsent: boolean;
  doNotSell: boolean;
  consentUpdatedAt: Date | null;
  privacyRestrictions: Record<string, boolean> | null;
  processingObjections: Record<string, string> | null;
}

export interface UserDataExport {
  exportedAt: string;
  format: string;
  data: {
    profile: {
      id: number;
      username: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      isActive: boolean;
      isEmailVerified: boolean;
      createdAt: Date;
      updatedAt: Date;
      lastLoginAt: Date | null;
      preferences: Record<string, any> | null;
    };
    privacyPreferences: PrivacyPreferences;
    loginHistory: any[];
    behaviorProfile: any | null;
    securityAlerts: any[];
  };
}

export interface DeleteAccountResult {
  success: boolean;
  deletedAt: Date;
  message: string;
}

export interface PrivacyTicket {
  id: number;
  requestType: string;
  status: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable({
  providedIn: 'root'
})
export class PrivacyService {
  private apiUrl = '/api/privacy';

  constructor(private http: HttpClient) {}

  getPreferences(): Observable<PrivacyPreferences> {
    return this.http.get<PrivacyPreferences>(`${this.apiUrl}/preferences`);
  }

  getExportPreview(): Observable<Record<string, number>> {
    return this.http.get<Record<string, number>>(`${this.apiUrl}/export/preview`);
  }

  exportData(): Observable<UserDataExport> {
    return this.http.get<UserDataExport>(`${this.apiUrl}/export`);
  }

  downloadData(): Observable<any> {
    return this.http.post(`${this.apiUrl}/export/download`, {});
  }

  deleteAccount(): Observable<DeleteAccountResult> {
    return this.http.delete<DeleteAccountResult>(`${this.apiUrl}/account`);
  }

  updateRestrictions(restrictions: Record<string, boolean>): Observable<any> {
    return this.http.patch(`${this.apiUrl}/restrictions`, { restrictions });
  }

  submitObjection(processingType: string, reason: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/object`, { processingType, reason });
  }

  removeObjection(processingType: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/object/${processingType}`);
  }

  updateMarketingConsent(consent: boolean): Observable<any> {
    return this.http.patch(`${this.apiUrl}/marketing`, { consent });
  }

  updateDoNotSell(doNotSell: boolean): Observable<any> {
    return this.http.patch(`${this.apiUrl}/do-not-sell`, { doNotSell });
  }

  createPublicTicket(data: { email: string; requestType: string; description: string; captchaToken: string }): Observable<any> {
    return this.http.post(`${this.apiUrl}/tickets/public`, data);
  }

  createTicket(requestType: string, description: string, additionalData?: Record<string, any>): Observable<PrivacyTicket> {
    return this.http.post<PrivacyTicket>(`${this.apiUrl}/tickets`, {
      requestType,
      description,
      additionalData
    });
  }

  getTickets(): Observable<PrivacyTicket[]> {
    return this.http.get<PrivacyTicket[]>(`${this.apiUrl}/tickets`);
  }

  getTicket(id: number): Observable<PrivacyTicket> {
    return this.http.get<PrivacyTicket>(`${this.apiUrl}/tickets/${id}`);
  }
}