import { Component, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSort, Sort } from '@angular/material/sort';
import { environment } from '../../../../environments/environment';
import { PermissionService } from '../../../core/services/permission.service';
import { Router } from '@angular/router';
import { catchError, startWith, switchMap, debounceTime } from 'rxjs/operators';
import { of, throwError, merge } from 'rxjs';

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
  
  // Data - using plain array for pure server-side sorting
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
  
  // Sorting - pure server-side approach
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
    // Check permission using resource:action format - match backend requirement
    this.permissionService.hasPermission('login-monitoring:read').subscribe(hasPermission => {
      this.hasPermission = hasPermission;
      
      if (hasPermission) {
        this.loadStats();
        this.detectPatterns();
        // Set flag to initialize reactive pattern after ViewChild is available
        this.shouldInitializeReactivePattern = true;
        // If ViewChild is already available, initialize immediately
        if (this.sort) {
          this.initializeReactivePattern();
        }
      } else {
        this.snackBar.open('You do not have permission to view this page.', 'Close', { duration: 5000 });
        this.router.navigate(['/app/dashboard']);
      }
    });
  }

  ngAfterViewInit(): void {
    // If permission check completed and we should initialize, do it now
    if (this.shouldInitializeReactivePattern && this.hasPermission) {
      this.initializeReactivePattern();
    }
  }

  private shouldInitializeReactivePattern = false;

  /**
   * Initialize the reactive pattern after both permission check and ViewChild are available
   * This prevents the race condition and infinite retry loop
   */
  private initializeReactivePattern(): void {
    console.log('[DEBUG] initializeReactivePattern called', {
      hasPermission: this.hasPermission,
      sortAvailable: !!this.sort,
      alreadyInitialized: this.reactivePatternInitialized
    });
    
    // Prevent multiple initializations
    if (this.reactivePatternInitialized) {
      console.log('[DEBUG] Already initialized, skipping');
      return;
    }
    
    // Ensure both permission and ViewChild are available
    if (!this.hasPermission || !this.sort) {
      console.log('[DEBUG] Prerequisites not met', {
        hasPermission: this.hasPermission,
        sortAvailable: !!this.sort
      });
      return;
    }
    
    console.log('[DEBUG] Initializing reactive pattern...');
    this.reactivePatternInitialized = true;
    
    // Set initial sort state to match our default
    this.sort.active = this.currentSort.active;
    this.sort.direction = this.currentSort.direction;
    
    // Reset pagination when sorting changes (industry best practice)
    this.sort.sortChange.subscribe(() => {
      this.currentPage = 0;
    });
    
    // Complete reactive pattern: merge all user interaction events
    // This is the industry-standard approach for server-side operations
    merge(
      this.sort.sortChange,
      this.filterForm.valueChanges.pipe(debounceTime(300)) // Debounce filter changes
    )
    .pipe(
      startWith({}), // Trigger initial load - now safe because permissions are confirmed
      switchMap(() => {
        console.log('[DEBUG] Reactive pattern triggered, loading data...');
        // Update current sort state from MatSort
        if (this.sort.active && this.sort.direction) {
          this.currentSort = {
            active: this.sort.active,
            direction: this.sort.direction
          };
        }
        
        // Trigger server-side sorted query
        return this.loadAttemptsReactive();
      })
    )
    .subscribe({
      next: (data) => {
        console.log('[DEBUG] Data received from API:', data);
        // Pure server-side approach - use the sorted data directly from API
        this.recentAttempts = data.items || [];
        this.totalAttempts = data.total || 0;
        this.loading.attempts = false;
        console.log('[DEBUG] Updated component state:', {
          attemptsCount: this.recentAttempts.length,
          totalAttempts: this.totalAttempts,
          loading: this.loading.attempts
        });
      },
      error: (error) => {
        console.error('[DEBUG] Error in reactive pattern:', error);
        this.handleApiError('login attempts', error);
        this.loading.attempts = false;
      }
    });
    
    console.log('[DEBUG] Reactive pattern initialization complete');
  }

  private reactivePatternInitialized = false;

  /**
   * Reactive data loading method that returns Observable
   * This follows the industry-standard pattern for server-side operations
   */
  private loadAttemptsReactive() {
    console.log('[DEBUG] loadAttemptsReactive called', {
      hasPermission: this.hasPermission,
      currentSort: this.currentSort,
      currentPage: this.currentPage,
      pageSize: this.pageSize
    });
    
    if (!this.hasPermission) {
      console.log('[DEBUG] No permission, returning empty data');
      return of({ items: [], total: 0 });
    }
    
    this.loading.attempts = true;
    
    const filters = this.filterForm.value;
    let url = `${this.apiUrl}/attempts/recent?limit=${this.pageSize}&offset=${this.currentPage * this.pageSize}`;
    
    // Add sorting parameters - pure server-side sorting with SQL ORDER BY
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
    
    console.log('[DEBUG] Making API call to:', url);
    
    return this.http.get<any>(url)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('[DEBUG] API call failed:', error);
          this.handleApiError('login attempts', error);
          return of({ items: [], total: 0 });
        })
      );
  }

  /**
   * Trigger method to manually refresh data using the reactive pattern
   * This replaces the old loadRecentAttempts method
   */
  triggerDataRefresh(): void {
    // Manually trigger the filter form to emit, which will trigger the reactive pattern
    this.filterForm.updateValueAndValidity({ emitEvent: true });
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
    this.triggerDataRefresh();
  }

  applyFilters(): void {
    this.currentPage = 0;
    this.triggerDataRefresh();
  }

  pageChange(event: any): void {
    this.currentPage = event.pageIndex;
    this.pageSize = event.pageSize;
    this.triggerDataRefresh();
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