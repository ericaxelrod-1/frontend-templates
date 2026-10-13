import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** Title-cased by the backend, because the UI switch matches on it exactly. */
export type SystemHealthStatus = 'Healthy' | 'Warning' | 'Critical' | 'Panic' | 'Unknown';

export interface SystemResourceUsage {
  total: number;
  used: number;
  free: number;
  percentage: number;
}

export interface SystemHealth {
  status: SystemHealthStatus;
  disk: SystemResourceUsage;
  /** Host-wide, from os.totalmem()/os.freemem() — not this process's heap. */
  memory: SystemResourceUsage;
  /** This process only; meaningless as a host figure in a multi-instance deploy. */
  process: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };
  activeJobs: number;
  pendingTickets: number;
  /** When the Sentinel last looked. Null only before the first check completes. */
  lastCheck: string | null;
  /** Non-null when the last measurement failed. */
  lastError: string | null;
  /** DISABLE_SENTINEL_GUARD is set: the gate is open, the measurement is not. */
  guardDisabled: boolean;
  thresholds: {
    warningPercent: number;
    criticalPercent: number;
    panicPercent: number;
  };
}

export interface ClearTempResult {
  message: string;
  scannedFiles: number;
  removedFiles: number;
  freedBytes: number;
  errors: string[];
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

  /**
   * Deletes finished exports past their retention window. Requires the
   * `system:manage` permission server-side — the same call the nightly cron
   * makes, not a separate mechanism.
   */
  clearTempFiles(): Observable<ClearTempResult> {
    return this.http.post<ClearTempResult>(`${this.apiUrl}/clear-temp`, {});
  }
}