import { Component, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSort, Sort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';
import { environment } from '../../../../environments/environment';
import { PermissionService } from '../../../core/services/permission.service';
import { Router } from '@angular/router';
import { catchError } from 'rxjs/operators';
import { of, throwError } from 'rxjs';

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
export class LoginMonitoringComponent implements OnInit, AfterViewInit {
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
  
  // Sorting
  currentSort: Sort = {
    active: 'createdAt',
    direction: 'desc'
  };
  
  // Permission state
  hasPermission = false;
  
  // Loading state
  loading = {
    attempts: false,
    stats: false,
    patterns: false,
    ipReputation: false
  };

  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private http: HttpClient,
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private permissionService: PermissionService,
    private router: Router
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
    // Check permission using resource:action format
    this.permissionService.hasPermission('system:admin').subscribe(hasPermission => {
      this.hasPermission = hasPermission;
      
      if (hasPermission) {
        this.loadStats();
        this.loadRecentAttempts();
        this.detectPatterns();
      } else {
        this.snackBar.open('You do not have permission to view this page.', 'Close', { duration: 5000 });
        this.router.navigate(['/app/dashboard']);
      }
    });
  }

  ngAfterViewInit(): void {
    // Set default sort to timestamp descending
    this.sort.active = 'createdAt';
    this.sort.direction = 'desc';
    
    this.sort.sortChange.subscribe(() => {
      this.currentPage = 0;
      this.loadRecentAttempts();
    });
  }

  onSortChange(sort: Sort): void {
    this.currentSort = sort;
    this.currentPage = 0;
    this.loadRecentAttempts();
  }

  loadRecentAttempts(): void {
    if (!this.hasPermission) return;
    
    this.loading.attempts = true;
    
    const filters = this.filterForm.value;
    let url = `${this.apiUrl}/attempts/recent?limit=${this.pageSize}&offset=${this.currentPage * this.pageSize}`;
    
    // Add sorting parameters
    if (this.currentSort.active && this.currentSort.direction) {
      url += `&sortBy=${this.currentSort.active}&sortDirection=${this.currentSort.direction}`;
    }
    
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
    
    this.http.get<any>(url)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.handleApiError('login attempts', error);
          return of({ items: [], total: 0 });
        })
      )
      .subscribe({
        next: (data) => {
          this.recentAttempts = data.items || [];
          this.totalAttempts = data.total || 0;
          this.loading.attempts = false;
        }
      });
  }

  loadStats(): void {
    if (!this.hasPermission) return;
    
    this.loading.stats = true;
    
    this.http.get<Statistics>(`${this.apiUrl}/stats`)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.handleApiError('statistics', error);
          return of(null);
        })
      )
      .subscribe({
        next: (data) => {
          this.statistics = data;
          this.loading.stats = false;
        }
      });
  }

  detectPatterns(): void {
    if (!this.hasPermission) return;
    
    this.loading.patterns = true;
    
    this.http.get<Pattern[]>(`${this.apiUrl}/patterns/detect`)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.handleApiError('patterns', error);
          return of([]);
        })
      )
      .subscribe({
        next: (data) => {
          this.detectedPatterns = data || [];
          this.loading.patterns = false;
        }
      });
  }

  getIPReputation(ipAddress: string): void {
    if (!this.hasPermission) return;
    
    this.loading.ipReputation = true;
    
    this.http.get<{ reputation: IPReputation, recentAttempts: LoginAttempt[] }>(
      `${this.apiUrl}/ip/${encodeURIComponent(ipAddress)}`
    )
    .pipe(
      catchError((error: HttpErrorResponse) => {
        this.handleApiError(`IP reputation for ${ipAddress}`, error);
        return of({ reputation: null, recentAttempts: [] });
      })
    )
    .subscribe({
      next: (data) => {
        this.selectedIpReputation = data.reputation;
        this.loading.ipReputation = false;
      }
    });
  }

  blockIP(ipAddress: string): void {
    if (!this.hasPermission) return;
    
    this.http.post(`${this.apiUrl}/ip/${encodeURIComponent(ipAddress)}/block`, {})
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.handleApiError(`blocking IP ${ipAddress}`, error);
          return throwError(() => error);
        })
      )
      .subscribe({
        next: () => {
          this.snackBar.open(`IP ${ipAddress} has been blocked`, 'Close', { duration: 3000 });
          this.getIPReputation(ipAddress);
        }
      });
  }

  unblockIP(ipAddress: string): void {
    if (!this.hasPermission) return;
    
    this.http.post(`${this.apiUrl}/ip/${encodeURIComponent(ipAddress)}/unblock`, {})
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.handleApiError(`unblocking IP ${ipAddress}`, error);
          return throwError(() => error);
        })
      )
      .subscribe({
        next: () => {
          this.snackBar.open(`IP ${ipAddress} has been unblocked`, 'Close', { duration: 3000 });
          this.getIPReputation(ipAddress);
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
    if (!this.hasPermission) return;
    
    const message = prompt('Enter test alert message:');
    if (!message) return;
    
    this.http.post(`${this.apiUrl}/alert/test`, { message })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.handleApiError('sending test alert', error);
          return throwError(() => error);
        })
      )
      .subscribe({
        next: () => {
          this.snackBar.open('Test alert sent successfully', 'Close', { duration: 3000 });
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
  
  goToDashboard(): void {
    this.router.navigate(['/app/dashboard']);
  }
  
  // Common error handler
  private handleApiError(action: string, error: HttpErrorResponse): void {
    console.error(`Error ${action}:`, error);
    
    if (error.status === 403) {
      this.snackBar.open(`You don't have permission to view login monitoring data.`, 'Close', { duration: 5000 });
      this.hasPermission = false;
    } else {
      this.snackBar.open(`Error ${action}`, 'Close', { duration: 3000 });
    }
    
    this.loading.attempts = false;
    this.loading.stats = false;
    this.loading.patterns = false;
    this.loading.ipReputation = false;
  }
} 