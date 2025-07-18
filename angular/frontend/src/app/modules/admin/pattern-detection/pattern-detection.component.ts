import { Component, OnInit, OnDestroy, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatCardModule } from '@angular/material/card';
import { PatternDetectionService } from './shared/pattern-detection.service';
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
    FormsModule,
    MatButtonToggleModule,
    MatTooltipModule,
    MatExpansionModule,
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
  
  // Test mode state - controls whether to use simple or enhanced test data
  testMode: 'simple' | 'enhanced' = 'simple';
  
  // Expected test results for tooltips - maps each test type to expected patterns
  testExpectations = {
    simple: {
      brute_force: ['Brute Force (1 pattern)'],
      distributed_attack: ['Distributed Attack (1 pattern)'],
      credential_stuffing: ['Credential Stuffing (1 pattern)'],
      rapid_account_switching: ['Rapid Account Switching (1 pattern)'],
      ip_hopping: ['IP Hopping (1 pattern)'],
      suspicious_location: ['Suspicious Location (1 pattern)'],
      time_anomaly: ['Time Anomaly (1 pattern)']
    },
    enhanced: {
      brute_force: [
        'Brute Force (1 pattern)',
        'Suspicious Location (2-3 patterns)',
        'Rapid Account Switching (1 pattern)'
      ],
      distributed_attack: [
        'Distributed Attack (1 pattern)',
        'Suspicious Location (4 patterns)',
        'IP Hopping (1 pattern)'
      ],
      credential_stuffing: [
        'Credential Stuffing (1 pattern)',
        'Brute Force (1 pattern)',
        'Suspicious Location (1 pattern)'
      ],
      rapid_account_switching: [
        'Rapid Account Switching (1 pattern)',
        'Suspicious Location (1 pattern)',
        'Brute Force (1 pattern)'
      ],
      ip_hopping: [
        'IP Hopping (1 pattern)',
        'Suspicious Location (3-5 patterns)',
        'Distributed Attack (1 pattern)',
        'Rapid Account Switching (1-2 patterns)'
      ],
      suspicious_location: [
        'Suspicious Location (1-3 patterns)',
        'Time Anomaly (1 pattern)'
      ],
      time_anomaly: [
        'Time Anomaly (1 pattern)',
        'Suspicious Location (1 pattern)'
      ]
    }
  } as const;

  constructor(
    private patternDetectionService: PatternDetectionService,
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

  /**
   * Get tooltip text showing expected patterns for a test button
   * @param patternType The type of pattern test (e.g., 'ip_hopping')
   * @returns Formatted tooltip text listing expected patterns
   */
  getTestTooltip(patternType: string): string {
    const expectations = this.testExpectations[this.testMode][patternType as keyof typeof this.testExpectations.simple];
    if (!expectations) {
      return 'No expectations available for this pattern type';
    }
    return `This test will create:\n${expectations.join('\n')}`;
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
    
    this.patternDetectionService.getPatterns(
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
      error: (error: any) => {
        console.error('Error loading patterns:', error);
        this.loading = false;
      }
    });
  }



  private loadPatternSummary(): void {
    const timeFilter: TimeFilter = {
      timeRange: '7d' as "30d" | "24h" | "7d" | "90d" | "all" | undefined
    };

    this.patternDetectionService.getPatternSummary(timeFilter)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (summary: PatternSummary[]) => {
          this.patternSummary = summary;
        },
        error: (error: any) => {
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
    this.patternDetectionService.createTestPattern('brute_force', this.testMode)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadData();
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
    this.patternDetectionService.createTestPattern('distributed_attack', this.testMode)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadData();
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
    this.patternDetectionService.createTestPattern('credential_stuffing', this.testMode)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadData();
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
    this.patternDetectionService.createTestPattern('rapid_account_switching', this.testMode)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadData();
          this.loadPatternSummary();
          this.isCreatingTestData = false;
        },
        error: (error: any) => {
          console.error('Error creating test rapid account switching pattern:', error);
          this.isCreatingTestData = false;
        }
      });
  }

  createTestIpHopping(): void {
    this.isCreatingTestData = true;
    this.patternDetectionService.createTestPattern('ip_hopping', this.testMode)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadData();
          this.loadPatternSummary();
          this.isCreatingTestData = false;
        },
        error: (error: any) => {
          console.error('Error creating test IP hopping pattern:', error);
          this.isCreatingTestData = false;
        }
      });
  }

  createTestSuspiciousLocation(): void {
    this.isCreatingTestData = true;
    this.patternDetectionService.createTestPattern('suspicious_location', this.testMode)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadData();
          this.loadPatternSummary();
          this.isCreatingTestData = false;
        },
        error: (error: any) => {
          console.error('Error creating test suspicious location pattern:', error);
          this.isCreatingTestData = false;
        }
      });
  }

  createTestTimeAnomaly(): void {
    this.isCreatingTestData = true;
    this.patternDetectionService.createTestPattern('time_anomaly', this.testMode)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadData();
          this.loadPatternSummary();
          this.isCreatingTestData = false;
        },
        error: (error: any) => {
          console.error('Error creating test time anomaly pattern:', error);
          this.isCreatingTestData = false;
        }
      });
  }

  clearAllData(): void {
    this.isCreatingTestData = true;
    this.patternDetectionService.clearTestData()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadData(); // Use normal loadData() for clearing since we want to see the absence of data
          this.loadPatternSummary();
          this.isCreatingTestData = false;
        },
        error: (error: any) => {
          console.error('Error clearing test data:', error);
          this.isCreatingTestData = false;
        }
      });
  }
} 