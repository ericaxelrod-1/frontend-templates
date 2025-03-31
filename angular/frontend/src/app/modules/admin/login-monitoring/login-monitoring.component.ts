import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { environment } from '../../../../environments/environment';

interface LoginAttempt {
  id: number;
  ipAddress: string;
  userAgent: string;
  email: string;
  status: string;
  failureReason?: string;
  createdAt: Date;
}

interface Statistics {
  total: number;
  successful: number;
  failed: number;
  blocked: number;
  captchaRequired: number;
  timeframe: {
    startDate: Date;
    endDate: Date;
  };
}

interface Pattern {
  id: string;
  type: string;
  severity: string;
  details: string;
  timestamp: Date;
  ipAddresses: string[];
  email?: string;
}

interface IPReputation {
  ipAddress: string;
  failedAttempts: number;
  isBlocked: boolean;
  blockedUntil?: Date;
  lastFailedAttempt?: Date;
  reputation: number;
}

@Component({
  selector: 'app-login-monitoring',
  templateUrl: './login-monitoring.component.html',
  styleUrls: ['./login-monitoring.component.scss']
})
export class LoginMonitoringComponent implements OnInit {
  apiUrl = `${environment.apiUrl}/login-monitoring`;
  
  // Data
  recentAttempts: LoginAttempt[] = [];
  statistics: Statistics | null = null;
  detectedPatterns: Pattern[] = [];
  selectedIpReputation: IPReputation | null = null;
  
  // Filter form
  filterForm: FormGroup;
  
  // Display columns
  attemptColumns: string[] = ['id', 'timestamp', 'email', 'ipAddress', 'status', 'details', 'actions'];
  patternColumns: string[] = ['type', 'severity', 'details', 'timestamp', 'actions'];
  
  // Pagination
  totalAttempts = 0;
  pageSize = 10;
  currentPage = 0;
  
  // Loading state
  loading = {
    attempts: false,
    stats: false,
    patterns: false,
    ipReputation: false
  };

  constructor(
    private http: HttpClient,
    private fb: FormBuilder,
    private snackBar: MatSnackBar
  ) {
    this.filterForm = this.fb.group({
      email: [''],
      ipAddress: [''],
      status: [''],
      dateFrom: [null],
      dateTo: [null]
    });
  }

  ngOnInit(): void {
    this.loadStats();
    this.loadRecentAttempts();
    this.detectPatterns();
  }

  loadRecentAttempts(): void {
    this.loading.attempts = true;
    
    const filters = this.filterForm.value;
    let url = `${this.apiUrl}/attempts/recent?limit=${this.pageSize}&offset=${this.currentPage * this.pageSize}`;
    
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
    
    this.http.get<any>(url).subscribe({
      next: (data) => {
        this.recentAttempts = data.items || [];
        this.totalAttempts = data.total || 0;
        this.loading.attempts = false;
      },
      error: (error) => {
        this.snackBar.open('Error loading login attempts', 'Close', { duration: 3000 });
        console.error('Error loading login attempts:', error);
        this.loading.attempts = false;
      }
    });
  }

  loadStats(): void {
    this.loading.stats = true;
    
    this.http.get<Statistics>(`${this.apiUrl}/stats`).subscribe({
      next: (data) => {
        this.statistics = data;
        this.loading.stats = false;
      },
      error: (error) => {
        this.snackBar.open('Error loading statistics', 'Close', { duration: 3000 });
        console.error('Error loading statistics:', error);
        this.loading.stats = false;
      }
    });
  }

  detectPatterns(): void {
    this.loading.patterns = true;
    
    this.http.get<Pattern[]>(`${this.apiUrl}/patterns/detect`).subscribe({
      next: (data) => {
        this.detectedPatterns = data;
        this.loading.patterns = false;
      },
      error: (error) => {
        this.snackBar.open('Error detecting patterns', 'Close', { duration: 3000 });
        console.error('Error detecting patterns:', error);
        this.loading.patterns = false;
      }
    });
  }

  getIPReputation(ipAddress: string): void {
    this.loading.ipReputation = true;
    
    this.http.get<{ reputation: IPReputation, recentAttempts: LoginAttempt[] }>(
      `${this.apiUrl}/ip/${encodeURIComponent(ipAddress)}`
    ).subscribe({
      next: (data) => {
        this.selectedIpReputation = data.reputation;
        this.loading.ipReputation = false;
      },
      error: (error) => {
        this.snackBar.open(`Error loading IP reputation for ${ipAddress}`, 'Close', { duration: 3000 });
        console.error('Error loading IP reputation:', error);
        this.loading.ipReputation = false;
      }
    });
  }

  blockIP(ipAddress: string): void {
    this.http.post(`${this.apiUrl}/ip/${encodeURIComponent(ipAddress)}/block`, {}).subscribe({
      next: () => {
        this.snackBar.open(`IP ${ipAddress} has been blocked`, 'Close', { duration: 3000 });
        this.getIPReputation(ipAddress);
      },
      error: (error) => {
        this.snackBar.open(`Error blocking IP ${ipAddress}`, 'Close', { duration: 3000 });
        console.error('Error blocking IP:', error);
      }
    });
  }

  unblockIP(ipAddress: string): void {
    this.http.post(`${this.apiUrl}/ip/${encodeURIComponent(ipAddress)}/unblock`, {}).subscribe({
      next: () => {
        this.snackBar.open(`IP ${ipAddress} has been unblocked`, 'Close', { duration: 3000 });
        this.getIPReputation(ipAddress);
      },
      error: (error) => {
        this.snackBar.open(`Error unblocking IP ${ipAddress}`, 'Close', { duration: 3000 });
        console.error('Error unblocking IP:', error);
      }
    });
  }

  resetFilters(): void {
    this.filterForm.reset();
    this.loadRecentAttempts();
  }

  applyFilters(): void {
    this.currentPage = 0;
    this.loadRecentAttempts();
  }

  pageChange(event: any): void {
    this.currentPage = event.pageIndex;
    this.pageSize = event.pageSize;
    this.loadRecentAttempts();
  }

  sendTestAlert(): void {
    const message = prompt('Enter test alert message:');
    if (!message) return;
    
    this.http.post(`${this.apiUrl}/alert/test`, { message }).subscribe({
      next: () => {
        this.snackBar.open('Test alert sent successfully', 'Close', { duration: 3000 });
      },
      error: (error) => {
        this.snackBar.open('Error sending test alert', 'Close', { duration: 3000 });
        console.error('Error sending test alert:', error);
      }
    });
  }

  getSeverityClass(severity: string): string {
    switch (severity.toLowerCase()) {
      case 'critical':
      case 'high':
        return 'severity-high';
      case 'medium':
        return 'severity-medium';
      case 'low':
        return 'severity-low';
      default:
        return '';
    }
  }
} 