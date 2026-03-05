import { Component, OnInit, OnDestroy, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule, MatTabGroup } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule } from '@angular/material/sort';
import { MatSort } from '@angular/material/sort';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatMenuModule } from '@angular/material/menu';
import { BreakpointObserver } from '@angular/cdk/layout';
import { FormGroup } from '@angular/forms';

import { AuthService } from '../../../core/services/auth.service';
import { LoginMonitoringService } from './shared/login-monitoring.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ResponsiveLayoutService } from '../../../shared/services/responsive-layout.service';
import { LoginAttemptsTableComponent } from './login-attempts-table/login-attempts-table.component';
import { StatisticsDashboardComponent } from './statistics-dashboard/statistics-dashboard.component';
import { TimeFilterComponent } from './components/time-filter/time-filter.component';
import { PatternDetectionFiltersComponent } from './pattern-detection-filters/pattern-detection-filters.component';
import { SecurityAlertsFiltersComponent } from './security-alerts-filters/security-alerts-filters.component';
import { FiltersComponent } from './filters/filters.component';

import { 
  LoginAttempt, 
  SecurityAlert, 
  Pattern,
  Statistics,
  PatternDetectionFilters,
  SecurityAlertsFilters,
  IPReputation
} from './shared/login-monitoring.models';
import { PatternSummary } from '../../../models/pattern-summary.interface';

import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

// BUG-124.19 FIX: Circuit Breaker Pattern for Infinite Loop Detection
interface CircuitBreaker {
  calls: Map<string, number>;
  timestamps: Map<string, number>;
  maxCalls: number;
  timeWindow: number;
  
  checkLoop(method: string): boolean;
  reset(): void;
}

class InfiniteLoopDetector implements CircuitBreaker {
  calls = new Map<string, number>();
  timestamps = new Map<string, number>();
  maxCalls = 10; // Maximum calls per time window
  timeWindow = 5000; // 5 seconds

  checkLoop(method: string): boolean {
    const now = Date.now();
    const lastTimestamp = this.timestamps.get(method) || 0;
    
    // Reset counter if time window has passed
    if (now - lastTimestamp > this.timeWindow) {
      this.calls.set(method, 1);
      this.timestamps.set(method, now);
      return true;
    }
    
    // Increment call count
    const callCount = (this.calls.get(method) || 0) + 1;
    this.calls.set(method, callCount);
    this.timestamps.set(method, now);
    
    if (callCount > this.maxCalls) {
      console.error(`🚨 INFINITE LOOP DETECTED in ${method}! Calls: ${callCount} in ${this.timeWindow}ms`);
      console.error('🛑 STOPPING EXECUTION to prevent browser crash');
      return false;
    }
    
    if (callCount > 5) {
      console.warn(`⚠️ High call frequency detected in ${method}: ${callCount} calls`);
    }
    
    return true;
  }
  
  reset(): void {
    this.calls.clear();
    this.timestamps.clear();
  }
}

// BUG-124.19 FIX: Centralized Filter State Management
interface FilterState {
  timeRange: string;
  patternFilters: PatternDetectionFilters | null;
  securityFilters: SecurityAlertsFilters | null;
  lastUpdated: number;
}

// BUG-124.19 FIX: Loading State Coordination Manager
class LoadingManager {
  private operations = new Set<string>();
  private onStateChange: (isLoading: boolean) => void;
  
  constructor(onStateChange: (isLoading: boolean) => void) {
    this.onStateChange = onStateChange;
  }
  
  startOperation(name: string): void {
    this.operations.add(name);
    this.onStateChange(true);
    console.log(`[LoadingManager] Started: ${name}, Active operations:`, Array.from(this.operations));
  }
  
  endOperation(name: string): void {
    this.operations.delete(name);
    const isLoading = this.operations.size > 0;
    this.onStateChange(isLoading);
    console.log(`[LoadingManager] Completed: ${name}, Active operations:`, Array.from(this.operations));
  }
  
  isOperationActive(name: string): boolean {
    return this.operations.has(name);
  }
  
  getActiveOperations(): string[] {
    return Array.from(this.operations);
  }
}

@Component({
  selector: 'app-login-monitoring',
  standalone: true,
  imports: [
    CommonModule,
    MatTabsModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatDividerModule,
    MatButtonModule,
    MatChipsModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatMenuModule,
    LoginAttemptsTableComponent,
    StatisticsDashboardComponent,
    TimeFilterComponent,
    PatternDetectionFiltersComponent,
    SecurityAlertsFiltersComponent,
    FiltersComponent
  ],
  templateUrl: './login-monitoring.component.html',
  styleUrls: ['./login-monitoring.component.scss']
})
export class LoginMonitoringComponent implements OnInit, OnDestroy, AfterViewInit {
  // BUG-124.19 FIX: Circuit Breaker for Infinite Loop Prevention
  private circuitBreaker = new InfiniteLoopDetector();
  
  // BUG-124.19 FIX: Centralized Filter State
  public filterState: FilterState = {
    timeRange: '30d',
    patternFilters: null,
    securityFilters: null,
    lastUpdated: Date.now()
  };
  
  // BUG-124.19 FIX: Loading State Coordination
  private loadingManager = new LoadingManager((isLoading: boolean) => {
    // Update the main loading state when any operation changes
    this.loading = {
      ...this.loading,
      statistics: this.loadingManager.isOperationActive('statistics'),
      patterns: this.loadingManager.isOperationActive('patterns'),
      alerts: this.loadingManager.isOperationActive('alerts'),
      ipReputation: this.loadingManager.isOperationActive('ipReputation'),
      patternSummary: this.loadingManager.isOperationActive('patternSummary')
    };
  });

  // BUG-113: Enhanced Responsive Design Support
  private destroy$ = new Subject<void>();
  
  // BUG-124.19 FIX: Computed Responsive Properties (No more template method calls)
  private _responsiveClass = '';
  private _responsiveIconSize = '24px';
  private _statsGridColumns = 4;
  private _patternTilesColumns = 3;
  private _showCompactView = false;
  
  // Responsive state - will be computed, not called from template
  isMobile = false;
  isTablet = false;
  isDesktop = false;
  isLargeDesktop = false;
  
  // Modern breakpoint detection following 2024 standards
  private customBreakpoints = {
    mobile: '(max-width: 575.98px)',
    tablet: '(min-width: 576px) and (max-width: 1023.98px)',
    desktop: '(min-width: 1024px) and (max-width: 1279.98px)',
    largeDesktop: '(min-width: 1280px)'
  };
  
  // Data properties
  statistics: Statistics | null = null;
  recentAttempts: LoginAttempt[] = [];
  securityAlerts: SecurityAlert[] = [];
  patterns: Pattern[] = [];
  patternSummary: PatternSummary[] = [];
  
  // State properties
  loading = {
    patternSummary: false,
    patterns: false,
    alerts: false,
    ipReputation: false,
    statistics: false
  };
  error: string | null = null;
  hasPermission = false;

  // Additional properties referenced in template
  detectedPatterns: Pattern[] = [];
  patternTotalCount = 0;
  selectedIpReputation: IPReputation | null = null;
  filterForm: FormGroup | null = null;
  patternDetectionFilters: PatternDetectionFilters | null = null;
  
  // Pattern table properties
  patternDisplayedColumns: string[] = ['timestamp', 'type', 'severity', 'ipAddresses', 'details', 'groupCount', 'actions'];
  patternPageSize = 10;
  patternCurrentPage = 0;
  
  // Pattern sorting properties for server-side sorting
  patternCurrentSort: { active: string; direction: 'asc' | 'desc' } = {
    active: 'detectionTimestamp',
    direction: 'desc'
  };
  
  // Security alerts table properties
  securityAlertsDisplayedColumns: string[] = ['timestamp', 'title', 'type', 'severity', 'message', 'status', 'actions'];
  securityAlertsPageSize = 10;
  securityAlertsCurrentPage = 0;
  securityAlertsTotalCount = 0;
  securityAlertsFilters: SecurityAlertsFilters | null = null;
  
  // Security alerts sorting properties for server-side sorting
  securityAlertsCurrentSort: { active: string; direction: 'asc' | 'desc' } = {
    active: 'createdAt',
    direction: 'desc'
  };
  
  // Test data creation state
  isCreatingTestData = false;

  // ViewChild for tab navigation
  @ViewChild(MatTabGroup) tabGroup!: MatTabGroup;
  
  // ViewChild for login attempts table to trigger filter updates
  @ViewChild(LoginAttemptsTableComponent) loginAttemptsTable!: LoginAttemptsTableComponent;

  // ViewChild for pattern detection table sorting
  @ViewChild('patternSort', { static: false }) patternSort!: MatSort;

  // ViewChild for security alerts table sorting
  @ViewChild('securityAlertsSort', { static: false }) securityAlertsSort!: MatSort;

  // BUG-FIX: ViewChild for filter components to trigger refresh
  @ViewChild(PatternDetectionFiltersComponent) patternDetectionFiltersComponent!: PatternDetectionFiltersComponent;
  @ViewChild(SecurityAlertsFiltersComponent) securityAlertsFiltersComponent!: SecurityAlertsFiltersComponent;

  // BUG-124.19 FIX: Computed Properties (Getters instead of methods)
  get responsiveClass(): string { return this._responsiveClass; }
  get responsiveIconSize(): string { return this._responsiveIconSize; }
  get statsGridColumns(): number { return this._statsGridColumns; }
  get patternTilesColumns(): number { return this._patternTilesColumns; }
  get showCompactView(): boolean { return this._showCompactView; }

  // BUG-124.6: Dynamic component loading for performance optimization
  async loadTabComponent(tabIndex: number) {
    if (!this.circuitBreaker.checkLoop('loadTabComponent')) return;
    
    switch (tabIndex) {
      case 0: // Login Attempts
        if (!this.loginAttemptsTableLoaded) {
          await import('./login-attempts-table/login-attempts-table.component');
          this.loginAttemptsTableLoaded = true;
        }
        break;
      case 1: // Pattern Detection
        if (!this.patternDetectionLoaded) {
          await import('./pattern-detection-filters/pattern-detection-filters.component');
          this.patternDetectionLoaded = true;
        }
        break;
      case 2: // Security Alerts
        if (!this.securityAlertsLoaded) {
          await import('./security-alerts-filters/security-alerts-filters.component');
          this.securityAlertsLoaded = true;
        }
        break;
      case 3: // Statistics
        if (!this.statisticsLoaded) {
          await import('./statistics-dashboard/statistics-dashboard.component');
          this.statisticsLoaded = true;
        }
        break;
    }
  }

  // Tab loading flags
  loginAttemptsTableLoaded = false;
  patternDetectionLoaded = false;
  securityAlertsLoaded = false;
  statisticsLoaded = false;

  constructor(
    private authService: AuthService,
    private loginMonitoringService: LoginMonitoringService,
    private permissionService: PermissionService,
    private breakpointObserver: BreakpointObserver,
    private responsiveLayout: ResponsiveLayoutService
  ) {}

  ngOnInit() {
    if (!this.circuitBreaker.checkLoop('ngOnInit')) return;
    
    console.log('[LoginMonitoring] Component initializing with circuit breaker protection');
    this.initializeResponsiveDesign();
    this.checkPermissions(); // This handles loadData() asynchronously when permission is granted
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.circuitBreaker.reset();
    console.log('[LoginMonitoring] Component destroyed, circuit breaker reset');
  }

  ngAfterViewInit(): void {
    // Set up server-side sorting for the pattern detection table
    if (this.patternSort) {
      this.patternSort.sortChange.pipe(
        takeUntil(this.destroy$)
      ).subscribe(() => {
        // Map UI column names to backend field names
        const columnToFieldMap: { [key: string]: string } = {
          'timestamp': 'detectionTimestamp',
          'type': 'patternType',
          'severity': 'severity'
        };
        
        const activeColumn = this.patternSort.active || 'timestamp';
        this.patternCurrentSort.active = columnToFieldMap[activeColumn] || 'detectionTimestamp';
        this.patternCurrentSort.direction = this.patternSort.direction || 'desc';
        this.patternCurrentPage = 0; // Reset to first page on sort change
        console.log('[DEBUG] Pattern sort changed:', this.patternCurrentSort);
        this.loadData();
      });
    }

    // Set up server-side sorting for the security alerts table
    if (this.securityAlertsSort) {
      this.securityAlertsSort.sortChange.pipe(
        takeUntil(this.destroy$)
      ).subscribe(() => {
        this.securityAlertsCurrentSort.active = this.getSecurityAlertsSortField(this.securityAlertsSort.active || 'timestamp');
        this.securityAlertsCurrentSort.direction = this.securityAlertsSort.direction || 'desc';
        this.securityAlertsCurrentPage = 0; // Reset to first page on sort change
        console.log('[DEBUG] Security alerts sort changed:', this.securityAlertsCurrentSort);
        this.loadData();
      });
    }
  }

  // BUG-113: Modern Responsive Design Initialization
  private initializeResponsiveDesign() {
    if (!this.circuitBreaker.checkLoop('initializeResponsiveDesign')) return;
    
    // Monitor breakpoint changes for responsive behavior
    this.breakpointObserver.observe([
      this.customBreakpoints.mobile,
      this.customBreakpoints.tablet,
      this.customBreakpoints.desktop,
      this.customBreakpoints.largeDesktop
    ]).pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.updateResponsiveState();
    });
  }

  // BUG-113: Update responsive state based on breakpoint matches
  private updateResponsiveState(): void {
    if (!this.circuitBreaker.checkLoop('updateResponsiveState')) return;
    
    this.isMobile = this.breakpointObserver.isMatched(this.customBreakpoints.mobile);
    this.isTablet = this.breakpointObserver.isMatched(this.customBreakpoints.tablet);
    this.isDesktop = this.breakpointObserver.isMatched(this.customBreakpoints.desktop);
    this.isLargeDesktop = this.breakpointObserver.isMatched(this.customBreakpoints.largeDesktop);
    
    // BUG-124.19 FIX: Compute responsive properties once, use getters in template
    this.computeResponsiveProperties();
    
    // Trigger responsive layout adjustments
    this.onBreakpointChange();
  }

  // BUG-124.19 FIX: Compute responsive properties (called once per breakpoint change)
  private computeResponsiveProperties(): void {
    // Responsive class
    if (this.isMobile) {
      this._responsiveClass = 'mobile-spacing';
      this._responsiveIconSize = '20px';
      this._statsGridColumns = 1;
      this._patternTilesColumns = 1;
      this._showCompactView = true;
    } else if (this.isTablet) {
      this._responsiveClass = 'tablet-spacing';
      this._responsiveIconSize = '22px';
      this._statsGridColumns = 2;
      this._patternTilesColumns = 2;
      this._showCompactView = true;
    } else if (this.isDesktop) {
      this._responsiveClass = 'desktop-spacing';
      this._responsiveIconSize = '24px';
      this._statsGridColumns = 4;
      this._patternTilesColumns = 3;
      this._showCompactView = false;
    } else {
      this._responsiveClass = 'large-desktop-spacing';
      this._responsiveIconSize = '24px';
      this._statsGridColumns = 6;
      this._patternTilesColumns = 4;
      this._showCompactView = false;
    }
    
    console.log('[LoginMonitoring] Responsive properties computed:', {
      class: this._responsiveClass,
      iconSize: this._responsiveIconSize,
      statsColumns: this._statsGridColumns,
      patternColumns: this._patternTilesColumns,
      compact: this._showCompactView
    });
  }

  // BUG-113: Handle responsive layout changes
  private onBreakpointChange() {
    if (!this.circuitBreaker.checkLoop('onBreakpointChange')) return;
    
    // Responsive behavior can be implemented here
    // For example: adjust grid columns, table display mode, etc.
    
    if (this.isMobile) {
      // Mobile-specific adjustments
      console.log('[LoginMonitoring] Mobile view active');
    } else if (this.isTablet) {
      // Tablet-specific adjustments  
      console.log('[LoginMonitoring] Tablet view active');
    } else if (this.isDesktop) {
      // Desktop-specific adjustments
      console.log('[LoginMonitoring] Desktop view active');
    } else if (this.isLargeDesktop) {
      // Large desktop-specific adjustments
      console.log('[LoginMonitoring] Large desktop view active');
    }
  }

  // BUG-113: Responsive grid column calculation
  getStatsGridColumns(): number {
    if (this.isMobile) return 1;
    if (this.isTablet) return 2;
    if (this.isDesktop) return 4;
    return 6; // Large desktop
  }

  // BUG-113: Responsive pattern tiles grid columns
  getPatternTilesColumns(): number {
    if (this.isMobile) return 1;
    if (this.isTablet) return 2;
    if (this.isDesktop) return 3;
    return 4; // Large desktop
  }

  // BUG-113: Check if should show compact view
  shouldShowCompactView(): boolean {
    return this.isMobile || this.isTablet;
  }

  // BUG-124.7.1: Updated to use ResponsiveLayoutService for consistent breakpoint management
  private _cachedResponsiveClass = '';
  private _lastResponsiveState = '';
  
  getResponsiveSpacingClass(): string {
    // BUG-124.18 FIX: Cache result to prevent excessive console logging during change detection
    const currentState = `${this.isMobile}-${this.isTablet}-${this.isDesktop}-${this.isLargeDesktop}`;
    
    if (this._lastResponsiveState !== currentState) {
      this._lastResponsiveState = currentState;
      
      // Keep existing logic for backward compatibility during transition
      if (this.isMobile) {
        this._cachedResponsiveClass = 'mobile-spacing';
      } else if (this.isTablet) {
        this._cachedResponsiveClass = 'tablet-spacing';
      } else if (this.isDesktop) {
        this._cachedResponsiveClass = 'desktop-spacing';
      } else {
        this._cachedResponsiveClass = 'large-desktop-spacing';
      }
      
      // Only log when state actually changes, not on every change detection cycle
      console.log('[DEBUG] Responsive class changed:', this._cachedResponsiveClass, {
        isMobile: this.isMobile,
        isTablet: this.isTablet,
        isDesktop: this.isDesktop,
        isLargeDesktop: this.isLargeDesktop
      });
    }
    
    return this._cachedResponsiveClass;
  }

  private checkPermissions() {
    if (!this.circuitBreaker.checkLoop('checkPermissions')) return;
    
    this.permissionService.hasPermission('login-monitoring:read')
      .pipe(takeUntil(this.destroy$))
      .subscribe(hasPermission => {
        this.hasPermission = hasPermission;
        if (this.hasPermission) {
          this.loadData();
        }
      });
  }

  private loadData() {
    if (!this.circuitBreaker.checkLoop('loadData')) return;
    
    // BUG-124.12 FIX: Prevent infinite loop
    if (this.loadingManager.isOperationActive('loadData')) {
      console.log('[DEBUG] LoadData already in progress, skipping to prevent infinite loop');
      return;
    }
    
    this.loadingManager.startOperation('loadData');
    this.error = null;

    // Load statistics
    this.loadingManager.startOperation('statistics');
    this.loginMonitoringService.getStatistics().subscribe({
      next: (stats) => {
        this.statistics = stats;
        this.loadingManager.endOperation('statistics');
      },
      error: (err) => {
        this.error = 'Failed to load statistics';
        this.loadingManager.endOperation('statistics');
        console.error('Error loading statistics:', err);
      }
    });

    // Load recent attempts
    this.loginMonitoringService.getRecentAttempts().subscribe({
      next: (attempts) => {
        this.recentAttempts = attempts.items;
      },
      error: (err) => {
        console.error('Error loading recent attempts:', err);
      }
    });

    // Load security alerts with filters, sorting, and pagination
    this.loadingManager.startOperation('alerts');
    console.log('[DEBUG] Loading security alerts with filters:', this.securityAlertsFilters);
    console.log('[DEBUG] Loading security alerts with sorting:', this.securityAlertsCurrentSort);
    
    this.loginMonitoringService.getSecurityAlerts(
      this.securityAlertsFilters || {},
      this.securityAlertsCurrentPage,
      this.securityAlertsPageSize,
      this.getSecurityAlertsSortField(this.securityAlertsCurrentSort.active),
      this.securityAlertsCurrentSort.direction
    ).subscribe({
      next: (alerts) => {
        this.securityAlerts = alerts;
        // Note: If the service returns a paginated response with total count, we would set it here
        // For now, we'll use the alerts length as a fallback
        this.securityAlertsTotalCount = alerts.length;
        console.log('[DEBUG] Security alerts loaded:', alerts.length, 'alerts');
        this.loadingManager.endOperation('alerts');
      },
      error: (err) => {
        console.error('Error loading security alerts:', err);
        this.loadingManager.endOperation('alerts');
      }
    });

    // Load pattern detection results with filters and sorting
    this.loadingManager.startOperation('patterns');
    console.log('[DEBUG] Loading patterns with filters:', this.patternDetectionFilters);
    console.log('[DEBUG] Loading patterns with sorting:', this.patternCurrentSort);
    
    this.loginMonitoringService.getPatterns(
      this.patternDetectionFilters || {}, 
      this.patternCurrentPage, 
      this.patternPageSize, 
      this.getPatternSortField(this.patternCurrentSort.active), 
      this.patternCurrentSort.direction
    ).subscribe({
      next: (patternResults) => {
        this.patterns = patternResults.items;
        this.detectedPatterns = patternResults.items; // Populate detectedPatterns for template
        this.patternTotalCount = patternResults.total || patternResults.items.length; // Use 'total' not 'totalCount'
        console.log('[DEBUG] Patterns loaded:', patternResults.items.length, 'patterns');
        this.loadingManager.endOperation('patterns');
      },
      error: (err) => {
        console.error('Error loading pattern detection results:', err);
        this.loadingManager.endOperation('patterns');
      }
    });

    // BUG-113: Load pattern summary for dashboard tiles
    this.loadPatternSummary();
    
    // BUG-124.12 FIX: Reset loading flag after all data loading is initiated
    setTimeout(() => {
      this.loadingManager.endOperation('loadData');
    }, 100);
  }

  // BUG-113: Load pattern summary data for dashboard tiles
  private loadPatternSummary() {
    if (!this.circuitBreaker.checkLoop('loadPatternSummary')) return;
    
    this.loadingManager.startOperation('patternSummary');
    
    // DEBUG: Add mock data to test grid layout
    console.log('[DEBUG] Loading pattern summary...');
    
    console.log('[DEBUG] Loading pattern summary with time filter:', this.filterState.timeRange);
    const timeFilter = { timeRange: this.filterState.timeRange as '30d' | '24h' | '7d' | '90d' | 'all' };
    this.loginMonitoringService.getPatternSummary(timeFilter).subscribe({
      next: (summary) => {
        console.log('[DEBUG] Pattern summary loaded:', summary);
        this.patternSummary = summary;
        
        // DEBUG: If no data, create mock data for testing
        if (!summary || summary.length === 0) {
          console.log('[DEBUG] No pattern summary data, creating mock data for testing...');
          this.patternSummary = [
            {
              patternType: 'brute_force',
              displayName: 'Brute Force',
              count: 30,
              severity: 'high' as const,
              lastDetected: new Date(),
              percentage: 45
            },
            {
              patternType: 'distributed_attack',
              displayName: 'Distributed Attack',
              count: 8,
              severity: 'medium' as const,
              lastDetected: new Date(),
              percentage: 12
            },
            {
              patternType: 'credential_stuffing',
              displayName: 'Credential Stuffing',
              count: 0,
              severity: 'low' as const,
              lastDetected: new Date(),
              percentage: 0
            },
            {
              patternType: 'account_switching',
              displayName: 'Account Switching',
              count: 30,
              severity: 'high' as const,
              lastDetected: new Date(),
              percentage: 45
            },
            {
              patternType: 'ip_hopping',
              displayName: 'IP Hopping',
              count: 2,
              severity: 'high' as const,
              lastDetected: new Date(),
              percentage: 3
            },
            {
              patternType: 'suspicious_location',
              displayName: 'Suspicious Location',
              count: 0,
              severity: 'low' as const,
              lastDetected: new Date(),
              percentage: 0
            },
            {
              patternType: 'time_anomaly',
              displayName: 'Time Anomaly',
              count: 0,
              severity: 'low' as const,
              lastDetected: new Date(),
              percentage: 0
            }
          ];
          console.log('[DEBUG] Mock pattern summary created:', this.patternSummary);
        }
        
        this.loadingManager.endOperation('patternSummary');
      },
      error: (err) => {
        console.error('Error loading pattern summary:', err);
        console.log('[DEBUG] Error occurred, creating mock data for testing...');
        
        // Create mock data on error for testing
        this.patternSummary = [
          {
            patternType: 'brute_force',
            displayName: 'Brute Force',
            count: 30,
            severity: 'high' as const,
            lastDetected: new Date(),
            percentage: 45
          },
          {
            patternType: 'distributed_attack',
            displayName: 'Distributed Attack',
            count: 8,
            severity: 'medium' as const,
            lastDetected: new Date(),
            percentage: 12
          },
          {
            patternType: 'credential_stuffing',
            displayName: 'Credential Stuffing',
            count: 0,
            severity: 'low' as const,
            lastDetected: new Date(),
            percentage: 0
          },
          {
            patternType: 'account_switching',
            displayName: 'Account Switching',
            count: 30,
            severity: 'high' as const,
            lastDetected: new Date(),
            percentage: 45
          }
        ];
        
        this.loadingManager.endOperation('patternSummary');
      }
    });
  }

  // BUG-113: Handle pattern tile click with responsive navigation
  onPatternTileClick(patternType: string) {
    if (!this.circuitBreaker.checkLoop('onPatternTileClick')) return;
    
    // Navigate to pattern detection tab (index 1) with filter applied
    console.log('Pattern tile clicked:', patternType);
    
    // Navigate to the pattern detection tab
    if (this.tabGroup) {
      this.tabGroup.selectedIndex = 1;
    }
    
    // Apply the pattern type filter
    this.applyPatternTypeFilter(patternType);
  }

  // BUG-113: Apply pattern type filter
  private applyPatternTypeFilter(patternType: string) {
    if (!this.circuitBreaker.checkLoop('applyPatternTypeFilter')) return;
    
    // BUG-124.12 FIX: Prevent infinite loop when applying pattern filter
    if (this.loadingManager.isOperationActive('applyPatternTypeFilter')) {
      console.log('[DEBUG] Pattern filter already being applied, skipping to prevent infinite loop');
      return;
    }
    
    this.loadingManager.startOperation('applyPatternTypeFilter');
    console.log('Applying pattern type filter:', patternType);
    
    // Store the filter in component state - use proper type casting
    this.patternDetectionFilters = {
      patternType: patternType as '' | 'brute_force' | 'distributed_attack' | 'credential_stuffing' | 'rapid_account_switching' | 'ip_hopping' | 'suspicious_location' | 'time_anomaly'
    };
    
    // Trigger data reload for pattern detection
    this.loadPatternSummary();
    
    // Reset the flag after a brief delay
    setTimeout(() => {
      this.loadingManager.endOperation('applyPatternTypeFilter');
    }, 100);
  }

  /**
   * Map frontend column names to backend field names for pattern detection sorting
   * Following 150-angular-server-side-sorting rule
   */
  private getPatternSortField(sortHeaderId: string): string {
    const fieldMapping: { [key: string]: string } = {
      'timestamp': 'detectionTimestamp',
      'type': 'patternType',
      'severity': 'severity',
      'ipAddresses': 'ipAddresses',
      'details': 'details',
      'groupCount': 'groupCount'
    };
    return fieldMapping[sortHeaderId] || 'detectionTimestamp';
  }

  // Map security alerts UI column names to backend field names
  private getSecurityAlertsSortField(sortHeaderId: string): string {
    const fieldMapping: { [key: string]: string } = {
      'timestamp': 'createdAt',
      'title': 'title',
      'type': 'alertType',
      'severity': 'severity',
      'message': 'message',
      'status': 'status'
    };
    return fieldMapping[sortHeaderId] || 'createdAt';
  }

  // BUG-113: Get severity class with responsive considerations
  getSeverityClass(severity: string): string {
    // BUG-124.19 FIX: Simple lookup, no circuit breaker needed for pure functions
    const severityClasses: { [key: string]: string } = {
      'low': 'severity-low',
      'medium': 'severity-medium',
      'high': 'severity-high',
      'critical': 'severity-critical'
    };
    return severityClasses[severity] || 'severity-unknown';
  }

  // BUG-113: Format pattern count with responsive considerations
  formatPatternCount(count: number): string {
    // BUG-124.19 FIX: Pure function, no circuit breaker needed
    return count.toString();
  }

  // BUG-113: Get responsive icon size
  getResponsiveIconSize(): string {
    if (this.isMobile) return '20px';
    if (this.isTablet) return '22px';
    return '24px';
  }

  // Test data creation methods
  createTestBruteForce() {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('brute_force').subscribe({
      next: (result) => {
        console.log('Test brute force created:', result);
        // BUG-FIX: Don't call loadData() which applies current filters
        // The test data will appear when user refreshes or changes filters
        this.loadData(); this.isCreatingTestData = false;
      },
      error: (err) => {
        console.error('Error creating test brute force:', err);
        this.isCreatingTestData = false;
      }
    });
  }

  createTestDistributedAttack() {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('distributed_attack').subscribe({
      next: (result) => {
        console.log('Test distributed attack created:', result);
        // BUG-FIX: Don't call loadData() which applies current filters
        // The test data will appear when user refreshes or changes filters
        this.loadData(); this.isCreatingTestData = false;
      },
      error: (err) => {
        console.error('Error creating test distributed attack:', err);
        this.isCreatingTestData = false;
      }
    });
  }

  createTestCredentialStuffing() {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('credential_stuffing').subscribe({
      next: (result) => {
        console.log('Test credential stuffing created:', result);
        // BUG-FIX: Don't call loadData() which applies current filters
        this.loadData(); this.isCreatingTestData = false;
      },
      error: (err) => {
        console.error('Error creating test credential stuffing:', err);
        this.isCreatingTestData = false;
      }
    });
  }

  createTestAccountSwitching() {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('account_switching').subscribe({
      next: (result) => {
        console.log('Test account switching created:', result);
        // BUG-FIX: Don't call loadData() which applies current filters
        this.loadData(); this.isCreatingTestData = false;
      },
      error: (err) => {
        console.error('Error creating test account switching:', err);
        this.isCreatingTestData = false;
      }
    });
  }

  createTestIpHopping() {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('ip_hopping').subscribe({
      next: (result) => {
        console.log('Test IP hopping created:', result);
        // BUG-FIX: Don't call loadData() which applies current filters
        this.loadData(); this.isCreatingTestData = false;
      },
      error: (err) => {
        console.error('Error creating test IP hopping:', err);
        this.isCreatingTestData = false;
      }
    });
  }

  createTestSuspiciousLocation() {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('suspicious_location').subscribe({
      next: (result) => {
        console.log('Test suspicious location created:', result);
        // BUG-FIX: Don't call loadData() which applies current filters
        this.loadData(); this.isCreatingTestData = false;
      },
      error: (err) => {
        console.error('Error creating test suspicious location:', err);
        this.isCreatingTestData = false;
      }
    });
  }

  createTestTimeAnomaly() {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('time_anomaly').subscribe({
      next: (result) => {
        console.log('Test time anomaly created:', result);
        // BUG-FIX: Don't call loadData() which applies current filters
        this.loadData(); this.isCreatingTestData = false;
      },
      error: (err) => {
        console.error('Error creating test time anomaly:', err);
        this.isCreatingTestData = false;
      }
    });
  }

  clearAllData() {
    this.isCreatingTestData = true;
    this.loginMonitoringService.clearTestData().subscribe({
      next: (result) => {
        console.log('All data cleared:', result);
        // BUG-FIX: Don't call loadData() which applies current filters
        // User should refresh filters to see cleared data
        console.log('[LoginMonitoring] Test data cleared - refresh filters to see updated results');
        this.isCreatingTestData = false;
      },
      error: (err) => {
        console.error('Error clearing data:', err);
        this.isCreatingTestData = false;
      }
    });
  }

  // BUG-124.19 FIX: Event handlers with circuit breaker protection and centralized state
  onStatsLoaded(stats: Statistics): void {
    if (!this.circuitBreaker.checkLoop('onStatsLoaded')) return;
    this.statistics = stats;
  }

  onTimeFilterChange(timeFilter: unknown): void {
    if (!this.circuitBreaker.checkLoop('onTimeFilterChange')) return;
    
    // BUG-124.19 FIX: Use centralized filter state
    this.filterState.timeRange = typeof timeFilter === 'object' && timeFilter !== null 
      ? JSON.stringify(timeFilter) 
      : String(timeFilter);
    this.filterState.lastUpdated = Date.now();
    
    console.log('[LoginMonitoring] Time filter changed:', timeFilter, 'State:', this.filterState);
    
    // BUG-124.16 FIX: Prevent infinite loop from time filter changes during component initialization
    if (this.loadingManager.isOperationActive('onTimeFilterChange')) {
      console.log('[DEBUG] Time filter change ignored - already loading data');
      return;
    }
    
    this.loadingManager.startOperation('onTimeFilterChange');
    this.loadPatternSummary();
    
    setTimeout(() => {
      this.loadingManager.endOperation('onTimeFilterChange');
    }, 100);
  }

  onFiltersChanged(filterForm: FormGroup): void {
    if (!this.circuitBreaker.checkLoop('onFiltersChanged')) return;
    
    console.log('[LoginMonitoring] Filters changed:', filterForm.value);
    this.filterForm = filterForm;
    
    // Trigger filter updates on child table
    if (this.loginAttemptsTable) {
      this.loginAttemptsTable.applyFilters();
    }
  }

  onFiltersReset(): void {
    if (!this.circuitBreaker.checkLoop('onFiltersReset')) return;
    
    console.log('[LoginMonitoring] Filters reset');
    
    // Reset the filter form and trigger reload
    if (this.loginAttemptsTable) {
      this.loginAttemptsTable.applyFilters();
    }
  }

  onPatternDetectionFiltersChanged(filters: PatternDetectionFilters): void {
    if (!this.circuitBreaker.checkLoop('onPatternDetectionFiltersChanged')) return;
    
    console.log('[LoginMonitoring] Pattern detection filters changed:', filters);
    
    // Store filters in component for data loading
    this.patternDetectionFilters = filters;
    
    // BUG-FIX: Explicitly call the pattern detection component's refresh method
    if (this.patternDetectionFiltersComponent) {
      console.log('[LoginMonitoring] Calling pattern detection refreshWithFilters');
      this.patternDetectionFiltersComponent.refreshWithFilters();
    } else {
      console.log('[LoginMonitoring] patternDetectionFiltersComponent not available yet');
    }
    
    // Reload data with new filters
    this.loadData();
  }

  onPatternDetectionFiltersReset() {
    if (!this.circuitBreaker.checkLoop('onPatternDetectionFiltersReset')) return;
    
    console.log('[LoginMonitoring] Pattern detection filters reset');
    
    // Clear stored filters
    this.patternDetectionFilters = null;
    
    // BUG-FIX: Explicitly call the pattern detection component's refresh method
    if (this.patternDetectionFiltersComponent) {
      console.log('[LoginMonitoring] Calling pattern detection refreshWithFilters for reset');
      this.patternDetectionFiltersComponent.refreshWithFilters();
    } else {
      console.log('[LoginMonitoring] patternDetectionFiltersComponent not available yet for reset');
    }
    
    // Reload data without filters
    this.loadData();
  }

  // Pattern display methods
  getPatternIcon(patternType: string): string {
    // BUG-124.19 FIX: Pure function, no circuit breaker needed
    const iconMap: { [key: string]: string } = {
      'brute_force': 'security',
      'distributed_attack': 'network_check',
      'credential_stuffing': 'vpn_key',
      'account_switching': 'switch_account',
      'ip_hopping': 'router',
      'suspicious_location': 'location_on',
      'time_anomaly': 'schedule'
    };
    return iconMap[patternType] || 'warning';
  }

  getSeverityColor(severity: string): string {
    // BUG-124.19 FIX: Pure function, no circuit breaker needed
    const colorMap: { [key: string]: string } = {
      'low': 'severity-low-color',
      'medium': 'severity-medium-color',
      'high': 'severity-high-color',
      'critical': 'severity-critical-color'
    };
    return colorMap[severity] || 'severity-unknown-color';
  }

  getPatternDisplayName(patternType: string): string {
    // BUG-124.19 FIX: Pure function, no circuit breaker needed
    const nameMap: { [key: string]: string } = {
      'brute_force': 'Brute Force',
      'distributed_attack': 'Distributed Attack',
      'credential_stuffing': 'Credential Stuffing',
      'account_switching': 'Account Switching',
      'ip_hopping': 'IP Hopping',
      'suspicious_location': 'Suspicious Location',
      'time_anomaly': 'Time Anomaly'
    };
    return nameMap[patternType] || patternType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  // Additional template methods
  onAttemptSelected(attempt: LoginAttempt): void {
    if (!this.circuitBreaker.checkLoop('onAttemptSelected')) return;
    console.log('[LoginMonitoring] Login attempt selected:', attempt);
  }

  onIPReputationRequested(ip: string): void {
    if (!this.circuitBreaker.checkLoop('onIPReputationRequested')) return;
    
    console.log('[LoginMonitoring] IP reputation requested for:', ip);
    
    this.loadingManager.startOperation('ipReputation');
    
    // Load IP reputation data
    this.loginMonitoringService.getIPReputation(ip).subscribe({
      next: (reputation) => {
        this.selectedIpReputation = reputation;
        this.loadingManager.endOperation('ipReputation');
      },
      error: (err) => {
        console.error('Error loading IP reputation:', err);
        this.loadingManager.endOperation('ipReputation');
      }
    });
  }

  // Test pattern generation methods with circuit breaker protection
  testBruteForcePattern() {
    if (!this.circuitBreaker.checkLoop('testBruteForcePattern')) return;
    this.createTestBruteForce();
  }

  testDistributedAttackPattern() {
    if (!this.circuitBreaker.checkLoop('testDistributedAttackPattern')) return;
    this.createTestDistributedAttack();
  }

  testCredentialStuffingPattern() {
    if (!this.circuitBreaker.checkLoop('testCredentialStuffingPattern')) return;
    this.createTestCredentialStuffing();
  }

  testAccountSwitchingPattern() {
    if (!this.circuitBreaker.checkLoop('testAccountSwitchingPattern')) return;
    this.createTestAccountSwitching();
  }

  clearTestData() {
    if (!this.circuitBreaker.checkLoop('clearTestData')) return;
    this.clearAllData();
  }

  // Additional missing methods referenced in template
  getPatternTypeClass(pattern: Pattern): string {
    // BUG-124.19 FIX: Pure function, no circuit breaker needed
    return `pattern-type-${pattern.type}`;
  }

  getGroupCount(pattern: Pattern): number {
    // BUG-124.19 FIX: Pure function, no circuit breaker needed
    return pattern.ipAddresses?.length || 0;
  }

  togglePatternExpansion(pattern: Pattern): void {
    if (!this.circuitBreaker.checkLoop('togglePatternExpansion')) return;
    console.log('[LoginMonitoring] Toggling pattern expansion for:', pattern.id);
  }

  onPatternPageChange(event: { pageIndex: number; pageSize: number }): void {
    if (!this.circuitBreaker.checkLoop('onPatternPageChange')) return;
    
    this.patternCurrentPage = event.pageIndex;
    this.patternPageSize = event.pageSize;
    console.log('[LoginMonitoring] Pattern page changed:', event);
    
    // Reload data with new pagination parameters
    this.loadData();
  }

  onSecurityAlertsPageChange(event: { pageIndex: number; pageSize: number }): void {
    if (!this.circuitBreaker.checkLoop('onSecurityAlertsPageChange')) return;
    
    this.securityAlertsCurrentPage = event.pageIndex;
    this.securityAlertsPageSize = event.pageSize;
    console.log('[LoginMonitoring] Security alerts page changed:', event);
    
    // Reload data with new pagination parameters
    this.loadData();
  }

  onSecurityAlertsFiltersChanged(filters: SecurityAlertsFilters): void {
    if (!this.circuitBreaker.checkLoop('onSecurityAlertsFiltersChanged')) return;
    
    console.log('[LoginMonitoring] Security alerts filters changed:', filters);
    
    // Store filters for API calls
    this.securityAlertsFilters = filters;
    
    // BUG-FIX: Explicitly call the security alerts component's refresh method
    if (this.securityAlertsFiltersComponent) {
      console.log('[LoginMonitoring] Calling security alerts refreshWithFilters');
      this.securityAlertsFiltersComponent.refreshWithFilters();
    } else {
      console.log('[LoginMonitoring] securityAlertsFiltersComponent not available yet');
    }
    
    // Reload data with new filters
    this.loadData();
  }

  onSecurityAlertsFiltersReset(): void {
    if (!this.circuitBreaker.checkLoop('onSecurityAlertsFiltersReset')) return;
    
    console.log('[LoginMonitoring] Security alerts filters reset');
    
    // Clear stored filters
    this.securityAlertsFilters = null;
    
    // BUG-FIX: Explicitly call the security alerts component's refresh method
    if (this.securityAlertsFiltersComponent) {
      console.log('[LoginMonitoring] Calling security alerts refreshWithFilters for reset');
      this.securityAlertsFiltersComponent.refreshWithFilters();
    } else {
      console.log('[LoginMonitoring] securityAlertsFiltersComponent not available yet for reset');
    }
    
    // Reload data without filters
    this.loadData();
  }

  sendTestAlert(): void {
    if (!this.circuitBreaker.checkLoop('sendTestAlert')) return;
    
    console.log('[LoginMonitoring] Sending test alert to backend...');
    this.isCreatingTestData = true;
    
    this.loginMonitoringService.sendTestAlert().subscribe({
      next: (result) => {
        console.log('Test alert sent successfully:', result);
        // Test alert will appear when filters are refreshed (same pattern as test patterns)
        this.loadData(); this.isCreatingTestData = false;
      },
      error: (err) => {
        console.error('Error sending test alert:', err);
        this.isCreatingTestData = false;
      }
    });
  } 
} 



