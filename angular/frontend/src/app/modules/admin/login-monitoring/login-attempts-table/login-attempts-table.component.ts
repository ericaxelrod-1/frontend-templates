import { Component, OnInit, AfterViewInit, Input, Output, EventEmitter, ViewChild } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { MatSort, Sort, MatSortable } from '@angular/material/sort';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { LoginMonitoringService } from '../shared/login-monitoring.service';
import { LoginMonitoringSharedModule } from '../shared/login-monitoring-shared.module';
import { LoginAttempt, LoginMonitoringFilters } from '../shared/login-monitoring.models';

@Component({
  selector: 'app-login-attempts-table',
  standalone: true,
  imports: [LoginMonitoringSharedModule],
  templateUrl: './login-attempts-table.component.html',
  styleUrls: ['./login-attempts-table.component.scss']
})
export class LoginAttemptsTableComponent implements OnInit, AfterViewInit {
  @Input() hasPermission = false;
  @Input() filterForm!: FormGroup;
  @Output() attemptSelected = new EventEmitter<LoginAttempt>();
  @Output() ipReputationRequested = new EventEmitter<string>();

  // Data
  recentAttempts: LoginAttempt[] = [];
  
  // Display columns - following 150-angular-server-side-sorting rule
  attemptColumns: string[] = [
    'id', 'timestamp', 'email', 'ipAddress', 
    'userAgent', 'status', 'details', 'metadata', 'actions'
  ];
  
  // Pagination
  totalAttempts = 0;
  pageSize = 10;
  currentPage = 0;
  
  // Sorting - pure server-side approach
  currentSort: Sort = {
    active: 'createdAt',
    direction: 'desc'
  };
  
  // Loading state
  loading = false;

  @ViewChild(MatSort) sort!: MatSort;

  // Lifecycle coordination flags - following 150-angular-server-side-sorting rule
  private shouldInitializeReactivePattern = false;
  private reactivePatternInitialized = false;

  constructor(
    private loginMonitoringService: LoginMonitoringService,
    private snackBar: MatSnackBar,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Handle async operations - permissions already checked by parent
    if (this.hasPermission) {
      this.shouldInitializeReactivePattern = true;
      
      // Initialize if ViewChild is already available
      if (this.sort) {
        this.initializeReactivePattern();
        // Load initial data AFTER reactive pattern is initialized
        this.loadRecentAttempts();
      }
      // Note: If ViewChild is not available yet, ngAfterViewInit will handle both initialization and initial load
    }
  }

  ngAfterViewInit(): void {
    // Initialize reactive pattern if permissions are ready
    if (this.shouldInitializeReactivePattern && !this.reactivePatternInitialized) {
      this.initializeReactivePattern();
      // Load initial data AFTER reactive pattern is initialized
      this.loadRecentAttempts();
    }
  }

  private initializeReactivePattern(): void {
    // Guard against multiple initialization
    if (this.reactivePatternInitialized || !this.sort || !this.hasPermission) {
      return;
    }
    
    this.reactivePatternInitialized = true;
    
    // ✅ FIX SORT INITIALIZATION RACE CONDITION:
    // Remove conflicting programmatic sort initialization that was causing the race condition
    // The template already has matSortActive="createdAt" and matSortDirection="desc"
    // so we just need to sync our component state with the template state
    
    // Sync component state with template-initialized MatSort state
    if (this.sort.active && this.sort.direction) {
      this.currentSort = {
        active: this.sort.active,
        direction: this.sort.direction
      };
    }
    
    // Set up sort change handler for user interactions
    this.sort.sortChange.subscribe(() => {
      this.currentPage = 0;
      // Update current sort state from MatSort
      if (this.sort.active && this.sort.direction) {
        this.currentSort = {
          active: this.sort.active,
          direction: this.sort.direction
        };
      }
      this.loadRecentAttempts();
    });
  }

  /**
   * Load recent login attempts using simple loading pattern
   * Following 150-angular-server-side-sorting rule
   */
  loadRecentAttempts(): void {
    if (!this.hasPermission) return;
    
    this.loading = true;
    
    const filters: LoginMonitoringFilters = this.filterForm ? this.filterForm.value : {};
    
    this.loginMonitoringService.getRecentAttempts(
      filters,
      this.currentPage,
      this.pageSize,
      this.getSortField(this.currentSort.active),
      this.currentSort.direction
    ).subscribe({
      next: (data) => {
        this.recentAttempts = data.items || [];
        this.totalAttempts = data.total || 0;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading login attempts:', error);
        this.snackBar.open('Failed to load login attempts', 'Close', { duration: 5000 });
        this.loading = false;
      }
    });
  }

  /**
   * Map frontend column names to backend field names
   * Following 150-angular-server-side-sorting rule
   */
  private getSortField(sortHeaderId: string): string {
    const fieldMapping: { [key: string]: string } = {
      'timestamp': 'createdAt',        // Frontend column -> Backend field
      'createdAt': 'createdAt',        
      'details': 'failureReason',
      'email': 'email',                
      'ipAddress': 'ipAddress',
      'status': 'status',
      'userAgent': 'userAgent',
      'id': 'id',
      'metadata': 'metadata'
    };
    
    return fieldMapping[sortHeaderId] || sortHeaderId;
  }

  // Pagination handler
  pageChange(event: any): void {
    this.currentPage = event.pageIndex;
    this.pageSize = event.pageSize;
    this.loadRecentAttempts();
  }

  // Event handlers
  onAttemptSelected(attempt: LoginAttempt): void {
    this.attemptSelected.emit(attempt);
  }

  onIPReputationRequest(ipAddress: string): void {
    this.ipReputationRequested.emit(ipAddress);
  }

  navigateToLoginAttempt(attemptId: number): void {
    this.router.navigate(['/app/admin/login-monitoring/attempt', attemptId]);
  }

  // Trigger method to manually refresh data
  triggerDataRefresh(): void {
    this.loadRecentAttempts();
  }

  // Apply filters from parent component
  applyFilters(): void {
    this.currentPage = 0; // Reset to first page
    this.loadRecentAttempts();
  }

  // Status severity mapping methods - following FEAT-123 pattern
  getStatusSeverityColor(status: string): string {
    switch (status.toLowerCase()) {
      case 'success':
        return 'low';           // Green for successful logins
      case 'failed':
        return 'medium';        // Orange for failed attempts
      case 'blocked':
        return 'high';          // Red for blocked attempts
      case 'captcha_required':
        return 'medium';        // Orange for CAPTCHA required
      case 'captcha_failed':
        return 'high';          // Red for CAPTCHA failures
      default:
        return 'default';       // Gray for unknown status
    }
  }

  getStatusSeverityLevel(status: string): string {
    switch (status.toLowerCase()) {
      case 'success':
        return 'low';
      case 'failed':
        return 'medium';
      case 'blocked':
        return 'high';
      case 'captcha_required':
        return 'medium';
      case 'captcha_failed':
        return 'high';
      default:
        return 'default';
    }
  }
} 