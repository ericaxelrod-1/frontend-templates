import { Component, OnInit, OnDestroy, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatCardModule } from '@angular/material/card';
import { LoginMonitoringService } from '../login-monitoring/shared/login-monitoring.service';
import { PermissionService } from '../../../core/services/permission.service';
import { PatternDetectionFiltersComponent } from '../login-monitoring/pattern-detection-filters/pattern-detection-filters.component';
import { TimeFilter, PatternSummary } from '../../../models/pattern-summary.interface';
import { Pattern, PatternDetectionFilters, PaginatedResponse } from '../login-monitoring/shared/login-monitoring.models';

@Component({
  selector: 'app-pattern-detection',
  templateUrl: './pattern-detection.component.html',
  styleUrls: ['./pattern-detection.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatMenuModule,
    MatCardModule,
    PatternDetectionFiltersComponent
  ]
})
export class PatternDetectionComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  private destroy$ = new Subject<void>();
  
  // Permission management
  hasPermission = false;
  loading = false;
  
  // Data properties
  detectedPatterns: Pattern[] = [];
  patternSummary: PatternSummary[] = [];
  patternTotalCount = 0;
  patternPageSize = 10;
  
  // Filter state
  filterState: PatternDetectionFilters = {
    status: '',
    patternType: '',
    severity: '',
    dateFrom: undefined,
    dateTo: undefined,
    search: ''
  };
  
  // Sorting state
  patternCurrentSort = {
    column: 'detectionTimestamp',
    direction: 'desc' as 'asc' | 'desc'
  };
  
  // Test data state
  isCreatingTestData = false;

  constructor(
    private loginMonitoringService: LoginMonitoringService,
    private permissionService: PermissionService
  ) {}

  ngOnInit(): void {
    this.checkPermissions();
  }

  ngAfterViewInit(): void {
    // Set up sorting
    if (this.sort) {
      this.sort.sortChange.pipe(takeUntil(this.destroy$)).subscribe(() => {
        this.onPatternSortChange();
      });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private checkPermissions(): void {
    this.permissionService.hasPermission('login-monitoring:read')
      .pipe(takeUntil(this.destroy$))
      .subscribe(hasPermission => {
        this.hasPermission = hasPermission;
        if (hasPermission) {
          this.loadData();
          this.loadPatternSummary();
        }
      });
  }

  private loadData(): void {
    this.loading = true;
    
    this.loginMonitoringService.getPatterns(
      this.filterState,
      0,
      this.patternPageSize,
      this.patternCurrentSort.column,
      this.patternCurrentSort.direction
    ).pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (response: PaginatedResponse<Pattern>) => {
        this.detectedPatterns = response.items;
        this.patternTotalCount = response.total;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading patterns:', error);
        this.loading = false;
      }
    });
  }

  // BUG-126 FIX: Load data after test creation with expanded date range to ensure test data is visible
  private loadDataAfterTest(): void {
    this.loading = true;
    
    // Create expanded filter state that includes freshly created test data
    const expandedFilters = { 
      ...this.filterState,
      // Expand date range to include last 10 minutes (covers all test scenarios)
      dateTo: new Date(), // Now
      dateFrom: new Date(Date.now() - 10 * 60 * 1000) // 10 minutes ago
    };
    
    console.log('[DEBUG] Loading data after test creation with expanded filters:', expandedFilters);
    
    this.loginMonitoringService.getPatterns(
      expandedFilters,
      0,
      this.patternPageSize,
      this.patternCurrentSort.column,
      this.patternCurrentSort.direction
    ).pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (response: PaginatedResponse<Pattern>) => {
        this.detectedPatterns = response.items;
        this.patternTotalCount = response.total;
        this.loading = false;
        console.log('[DEBUG] Data loaded after test creation:', response.items.length, 'patterns found');
      },
      error: (error) => {
        console.error('Error loading patterns after test:', error);
        this.loading = false;
      }
    });
  }

  private loadPatternSummary(): void {
    const timeFilter: TimeFilter = {
      timeRange: '7d' as "30d" | "24h" | "7d" | "90d" | "all" | undefined
    };

    this.loginMonitoringService.getPatternSummary(timeFilter)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (summary: PatternSummary[]) => {
          this.patternSummary = summary;
        },
        error: (error) => {
          console.error('Error loading pattern summary:', error);
        }
      });
  }

  // Event handlers
  onPatternDetectionFiltersChanged(filters: PatternDetectionFilters): void {
    this.filterState = { ...filters };
    this.loadData();
  }

  onPatternDetectionFiltersReset(): void {
    this.filterState = {
      status: '',
      patternType: '',
      severity: '',
      dateFrom: undefined,
      dateTo: undefined,
      search: ''
    };
    this.loadData();
  }

  onPatternSortChange(): void {
    if (this.sort) {
      this.patternCurrentSort = {
        column: this.sort.active,
        direction: this.sort.direction as 'asc' | 'desc'
      };
      this.loadData();
    }
  }

  onPatternPageChange(event: any): void {
    this.patternPageSize = event.pageSize;
    this.loadData();
  }

  // Utility methods
  formatPatternCount(count: number): string {
    if (count >= 1000000) {
      return (count / 1000000).toFixed(1) + 'M';
    } else if (count >= 1000) {
      return (count / 1000).toFixed(1) + 'K';
    } else {
      return count.toString();
    }
  }

  getSeverityClass(severity: string): string {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return 'severity-critical';
      case 'high':
        return 'severity-high';
      case 'medium':
        return 'severity-medium';
      case 'low':
        return 'severity-low';
      default:
        return 'severity-unknown';
    }
  }

  getPatternIcon(type: string): string {
    switch (type) {
      case 'brute_force':
        return 'security';
      case 'distributed_attack':
        return 'network_check';
      case 'credential_stuffing':
        return 'vpn_key';
      case 'rapid_account_switching':
        return 'switch_account';
      case 'ip_hopping':
        return 'router';
      case 'suspicious_location':
        return 'location_on';
      case 'time_anomaly':
        return 'schedule';
      default:
        return 'warning';
    }
  }

  getPatternDisplayName(type: string): string {
    switch (type) {
      case 'brute_force':
        return 'Brute Force';
      case 'distributed_attack':
        return 'Distributed Attack';
      case 'credential_stuffing':
        return 'Credential Stuffing';
      case 'rapid_account_switching':
        return 'Rapid Account Switching';
      case 'ip_hopping':
        return 'IP Hopping';
      case 'suspicious_location':
        return 'Suspicious Location';
      case 'time_anomaly':
        return 'Time Anomaly';
      default:
        return 'Unknown Pattern';
    }
  }

  // Test data methods
  createTestBruteForce(): void {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('brute_force')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadDataAfterTest();
          this.loadPatternSummary();
          this.isCreatingTestData = false;
        },
        error: (error) => {
          console.error('Error creating test brute force pattern:', error);
          this.isCreatingTestData = false;
        }
      });
  }

  createTestDistributedAttack(): void {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('distributed_attack')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadDataAfterTest();
          this.loadPatternSummary();
          this.isCreatingTestData = false;
        },
        error: (error) => {
          console.error('Error creating test distributed attack pattern:', error);
          this.isCreatingTestData = false;
        }
      });
  }

  createTestCredentialStuffing(): void {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('credential_stuffing')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadDataAfterTest();
          this.loadPatternSummary();
          this.isCreatingTestData = false;
        },
        error: (error) => {
          console.error('Error creating test credential stuffing pattern:', error);
          this.isCreatingTestData = false;
        }
      });
  }

  createTestRapidAccountSwitching(): void {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('rapid_account_switching')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadDataAfterTest();
          this.loadPatternSummary();
          this.isCreatingTestData = false;
        },
        error: (error) => {
          console.error('Error creating test rapid account switching pattern:', error);
          this.isCreatingTestData = false;
        }
      });
  }

  createTestIpHopping(): void {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('ip_hopping')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadDataAfterTest();
          this.loadPatternSummary();
          this.isCreatingTestData = false;
        },
        error: (error) => {
          console.error('Error creating test IP hopping pattern:', error);
          this.isCreatingTestData = false;
        }
      });
  }

  createTestSuspiciousLocation(): void {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('suspicious_location')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadDataAfterTest();
          this.loadPatternSummary();
          this.isCreatingTestData = false;
        },
        error: (error) => {
          console.error('Error creating test suspicious location pattern:', error);
          this.isCreatingTestData = false;
        }
      });
  }

  createTestTimeAnomaly(): void {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('time_anomaly')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadDataAfterTest();
          this.loadPatternSummary();
          this.isCreatingTestData = false;
        },
        error: (error) => {
          console.error('Error creating test time anomaly pattern:', error);
          this.isCreatingTestData = false;
        }
      });
  }

  clearAllData(): void {
    this.isCreatingTestData = true;
    this.loginMonitoringService.clearTestData()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadData(); // Use normal loadData() for clearing since we want to see the absence of data
          this.loadPatternSummary();
          this.isCreatingTestData = false;
        },
        error: (error) => {
          console.error('Error clearing test data:', error);
          this.isCreatingTestData = false;
        }
      });
  }
} 