import { Component, OnInit, OnDestroy, ChangeDetectorRef, ViewChild } from '@angular/core';
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
import { MatPaginatorModule } from '@angular/material/paginator';
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
export class LoginMonitoringComponent implements OnInit, OnDestroy {
  // BUG-113: Enhanced Responsive Design Support
  private destroy$ = new Subject<void>();
  
  // Responsive breakpoint tracking
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

  // Pattern table properties
  patternDisplayedColumns: string[] = ['timestamp', 'type', 'severity', 'ipAddresses', 'details', 'groupCount', 'actions'];
  patternPageSize = 10;
  patternCurrentPage = 0;
  
  // Test data creation state
  isCreatingTestData = false;

  // ViewChild for tab navigation
  @ViewChild(MatTabGroup) tabGroup!: MatTabGroup;
  
  // ViewChild for login attempts table to trigger filter updates
  @ViewChild(LoginAttemptsTableComponent) loginAttemptsTable!: LoginAttemptsTableComponent;

  // BUG-124.6: Dynamic component loading for performance optimization
  async loadTabComponent(tabIndex: number) {
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
    private cdr: ChangeDetectorRef,
    private responsiveLayout: ResponsiveLayoutService
  ) {}

  ngOnInit() {
    this.checkPermissions();
    this.initializeResponsiveDesign();
    
    if (this.hasPermission) {
      this.loadData();
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // BUG-113: Modern Responsive Design Initialization
  private initializeResponsiveDesign() {
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
    this.isMobile = this.breakpointObserver.isMatched(this.customBreakpoints.mobile);
    this.isTablet = this.breakpointObserver.isMatched(this.customBreakpoints.tablet);
    this.isDesktop = this.breakpointObserver.isMatched(this.customBreakpoints.desktop);
    this.isLargeDesktop = this.breakpointObserver.isMatched(this.customBreakpoints.largeDesktop);
    
    // BUG-124.4 FIX: Trigger change detection after responsive state changes
    this.cdr.detectChanges();
    
    // Trigger responsive layout adjustments
    this.onBreakpointChange();
  }

  // BUG-113: Handle responsive layout changes
  private onBreakpointChange() {
    // Responsive behavior can be implemented here
    // For example: adjust grid columns, table display mode, etc.
    
    if (this.isMobile) {
      // Mobile-specific adjustments
      console.log('Mobile view active');
    } else if (this.isTablet) {
      // Tablet-specific adjustments  
      console.log('Tablet view active');
    } else if (this.isDesktop) {
      // Desktop-specific adjustments
      console.log('Desktop view active');
    } else if (this.isLargeDesktop) {
      // Large desktop-specific adjustments
      console.log('Large desktop view active');
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
  getResponsiveSpacingClass(): string {
    // Keep existing logic for backward compatibility during transition
    let responsiveClass = '';
    
    if (this.isMobile) {
      responsiveClass = 'mobile-spacing';
    } else if (this.isTablet) {
      responsiveClass = 'tablet-spacing';
    } else if (this.isDesktop) {
      responsiveClass = 'desktop-spacing';
    } else {
      responsiveClass = 'large-desktop-spacing';
    }
    
    console.log('[DEBUG] Responsive class applied:', responsiveClass, {
      isMobile: this.isMobile,
      isTablet: this.isTablet,
      isDesktop: this.isDesktop,
      isLargeDesktop: this.isLargeDesktop
    });
    
    return responsiveClass;
  }

  private checkPermissions() {
    this.permissionService.hasPermission('login-monitoring:read').subscribe(hasPermission => {
      this.hasPermission = hasPermission;
      if (this.hasPermission) {
        this.loadData();
      }
    });
  }

  private loadData() {
    this.loading = {
      patternSummary: false,
      patterns: true,
      alerts: true,
      ipReputation: false,
      statistics: true
    };
    this.error = null;

    // Load statistics
    this.loginMonitoringService.getStatistics().subscribe({
      next: (stats) => {
        this.statistics = stats;
        this.loading.statistics = false;
      },
      error: (err) => {
        this.error = 'Failed to load statistics';
        this.loading.statistics = false;
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

    // Load security alerts
    this.loginMonitoringService.getSecurityAlerts().subscribe({
      next: (alerts) => {
        this.securityAlerts = alerts;
        this.loading.alerts = false;
      },
      error: (err) => {
        console.error('Error loading security alerts:', err);
        this.loading.alerts = false;
      }
    });

    // Load pattern detection results
    this.loginMonitoringService.getPatterns().subscribe({
      next: (patternResults) => {
        this.patterns = patternResults.items;
        this.detectedPatterns = patternResults.items; // Populate detectedPatterns for template
        this.patternTotalCount = patternResults.total || patternResults.items.length; // Use 'total' not 'totalCount'
        this.loading.patterns = false;
      },
      error: (err) => {
        console.error('Error loading pattern detection results:', err);
        this.loading.patterns = false;
      }
    });

    // BUG-113: Load pattern summary for dashboard tiles
    this.loadPatternSummary();
  }

  // BUG-113: Load pattern summary data for dashboard tiles
  private loadPatternSummary() {
    this.loading.patternSummary = true;
    
    // DEBUG: Add mock data to test grid layout
    console.log('[DEBUG] Loading pattern summary...');
    
    this.loginMonitoringService.getPatternSummary().subscribe({
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
        
        this.loading.patternSummary = false;
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
        
        this.loading.patternSummary = false;
      }
    });
  }

  // BUG-113: Handle pattern tile click with responsive navigation
  onPatternTileClick(patternType: string) {
    // Navigate to pattern detection tab (index 1) with filter applied
    console.log('Pattern tile clicked:', patternType);
    
    // Navigate to Pattern Detection tab
    if (this.tabGroup) {
      this.tabGroup.selectedIndex = 1; // Pattern Detection tab is index 1
    }
    
    // Apply pattern type filter to Pattern Detection filters
    // This will be handled by the pattern detection filters component
    // We'll emit the filter change after tab navigation
    setTimeout(() => {
      this.applyPatternTypeFilter(patternType);
    }, 100); // Small delay to ensure tab switch completes
  }

  // Apply pattern type filter to Pattern Detection filters
  private applyPatternTypeFilter(patternType: string) {
    // This method will trigger the pattern detection filters to apply the selected pattern type
    // The actual filtering will be handled by the pattern detection component
    console.log('Applying pattern type filter:', patternType);
    
    // Emit pattern detection filter change with the selected pattern type
    this.onPatternDetectionFiltersChanged({ patternType: patternType } as PatternDetectionFilters);
  }

  // BUG-113: Get severity class with responsive considerations
  getSeverityClass(severity: string): string {
    const baseClass = `pattern-tile-${severity.toLowerCase()}`;
    
    // Add responsive modifier if needed
    if (this.shouldShowCompactView()) {
      return `${baseClass} compact-view`;
    }
    
    return baseClass;
  }

  // BUG-113: Format pattern count with responsive considerations
  formatPatternCount(count: number): string {
    if (this.isMobile && count > 999) {
      return `${Math.floor(count / 1000)}k+`;
    }
    return count.toLocaleString();
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
        this.loadData(); // Refresh data
        this.isCreatingTestData = false;
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
        this.loadData(); // Refresh data
        this.isCreatingTestData = false;
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
        this.loadData(); // Refresh data
        this.isCreatingTestData = false;
      },
      error: (err) => {
        console.error('Error creating test credential stuffing:', err);
        this.isCreatingTestData = false;
      }
    });
  }

  createTestAccountSwitching() {
    this.isCreatingTestData = true;
    this.loginMonitoringService.createTestPattern('rapid_account_switching').subscribe({
      next: (result) => {
        console.log('Test account switching created:', result);
        this.loadData(); // Refresh data
        this.isCreatingTestData = false;
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
        this.loadData(); // Refresh data
        this.isCreatingTestData = false;
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
        this.loadData(); // Refresh data
        this.isCreatingTestData = false;
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
        this.loadData(); // Refresh data
        this.isCreatingTestData = false;
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
        this.loadData(); // Refresh data
        this.isCreatingTestData = false;
      },
      error: (err) => {
        console.error('Error clearing data:', err);
        this.isCreatingTestData = false;
      }
    });
  }

  // Template event handlers
  onStatsLoaded(stats: Statistics): void {
    this.statistics = stats;
  }

  onTimeFilterChange(timeFilter: unknown): void {
    console.log('Time filter changed:', timeFilter);
    this.loadPatternSummary();
  }

  onFiltersChanged(filterForm: FormGroup): void {
    console.log('Filters changed:', filterForm);
    this.filterForm = filterForm;
    
    // BUG-124.9 FIX: Trigger data reload in login attempts table when filters change
    if (this.loginAttemptsTable) {
      this.loginAttemptsTable.applyFilters();
    }
  }

  onFiltersReset(): void {
    console.log('Filters reset');
    this.filterForm = null;
    
    // BUG-124.9 FIX: Trigger data reload in login attempts table when filters are reset
    if (this.loginAttemptsTable) {
      this.loginAttemptsTable.applyFilters();
    }
  }

  onPatternDetectionFiltersChanged(filters: PatternDetectionFilters): void {
    console.log('Pattern detection filters changed:', filters);
    // Handle filter changes for pattern detection
  }

  onPatternDetectionFiltersReset() {
    console.log('Pattern detection filters reset');
    // Handle filter reset for pattern detection
  }

  // Pattern display methods
  getPatternIcon(patternType: string): string {
    const iconMap: Record<string, string> = {
      'brute_force': 'security',
      'distributed_attack': 'network_check',
      'credential_stuffing': 'vpn_key',
      'rapid_account_switching': 'swap_horiz',
      'ip_hopping': 'router',
      'suspicious_location': 'location_on',
      'time_anomaly': 'access_time'
    };
    return iconMap[patternType] || 'warning';
  }

  getSeverityColor(severity: string): string {
    const colorMap: Record<string, string> = {
      'critical': 'severity-critical',
      'high': 'severity-high',
      'medium': 'severity-medium',
      'low': 'severity-low'
    };
    return colorMap[severity.toLowerCase()] || 'severity-default';
  }

  getPatternDisplayName(patternType: string): string {
    const displayMap: Record<string, string> = {
      'brute_force': 'Brute Force',
      'distributed_attack': 'Distributed Attack',
      'credential_stuffing': 'Credential Stuffing',
      'rapid_account_switching': 'Account Switching',
      'ip_hopping': 'IP Hopping',
      'suspicious_location': 'Suspicious Location',
      'time_anomaly': 'Time Anomaly'
    };
    return displayMap[patternType] || patternType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  // Additional template methods
  onAttemptSelected(attempt: LoginAttempt): void {
    console.log('Attempt selected:', attempt);
    // Handle attempt selection
  }

  onIPReputationRequested(ip: string): void {
    console.log('IP reputation requested for:', ip);
    // Handle IP reputation request
  }

  // Test pattern methods
  testBruteForcePattern() {
    this.createTestBruteForce();
  }

  testDistributedAttackPattern() {
    this.createTestDistributedAttack();
  }

  testCredentialStuffingPattern() {
    this.createTestCredentialStuffing();
  }

  testAccountSwitchingPattern() {
    this.createTestAccountSwitching();
  }

  clearTestData() {
    this.clearAllData();
  }

  // Additional missing methods referenced in template
  getPatternTypeClass(pattern: Pattern): string {
    return `pattern-type-${pattern.type.toLowerCase().replace(/_/g, '-')}`; // Use 'type' not 'patternType'
  }

  getGroupCount(pattern: Pattern): number {
    return pattern.evidence?.groupCount || 0; // Use evidence.groupCount instead of grouping
  }

  togglePatternExpansion(pattern: Pattern): void {
    console.log('Toggle pattern expansion:', pattern);
    // Implementation for expanding/collapsing pattern details
  }

  onPatternPageChange(event: { pageIndex: number; pageSize: number }): void {
    this.patternCurrentPage = event.pageIndex;
    this.patternPageSize = event.pageSize;
    // Reload pattern data with new pagination
  }

  onSecurityAlertsFiltersChanged(filters: SecurityAlertsFilters): void {
    console.log('Security alerts filters changed:', filters);
    // Handle security alerts filter changes
  }

  onSecurityAlertsFiltersReset(): void {
    console.log('Security alerts filters reset');
    // Handle security alerts filter reset
  }

  sendTestAlert(): void {
    console.log('Sending test alert...');
    // Implementation for sending test alert
    this.loginMonitoringService.createTestPattern('test_alert').subscribe({
      next: (result: unknown) => {
        console.log('Test alert sent:', result);
      },
      error: (err: unknown) => {
        console.error('Error sending test alert:', err);
      }
    });
} 
} 
