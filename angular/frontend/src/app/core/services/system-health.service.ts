import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SystemHealth {
  status: 'Healthy' | 'Warning' | 'Critical' | 'Panic';
  disk: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  activeJobs: number;
  lastCheck: string;
}

@Injectable({
  providedIn: 'root'
})
export class SystemHealthService {
  private apiUrl = '/api/admin/system-health';

  constructor(private http: HttpClient) {}

  getHealth(): Observable<SystemHealth> {
    return this.http.get<SystemHealth>(this.apiUrl);
  }

  clearTempFiles(): Observable<any> {
    return this.http.post(`${this.apiUrl}/clear-temp`, {});
  }
}
