import { Component, OnInit, ViewChild } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabGroup } from '@angular/material/tabs';

import { PermissionService } from '../../../core/services/permission.service';
import { LoginMonitoringService } from './shared/login-monitoring.service';
import { LoginMonitoringSharedModule } from './shared/login-monitoring-shared.module';
import { StatisticsDashboardComponent } from './statistics-dashboard/statistics-dashboard.component';
import { FiltersComponent } from './filters/filters.component';
import { LoginAttemptsTableComponent } from './login-attempts-table/login-attempts-table.component';
import { SecurityAlertsFiltersComponent } from './security-alerts-filters/security-alerts-filters.component';
import { PatternDetectionFiltersComponent } from './pattern-detection-filters/pattern-detection-filters.component';
import { TimeFilterComponent } from './components/time-filter/time-filter.component';
import { 
  LoginAttempt, 
  Statistics, 
  Pattern, 
  SecurityAlert, 
  SecurityAlertsFilters,
  PatternDetectionFilters,
  IPReputation 
} from './shared/login-monitoring.models';
import { PatternSummary, TimeFilter } from '../../../models/pattern-summary.interface';

@Component({
  selector: 'app-login-monitoring',
  standalone: true,
  imports: [
    LoginMonitoringSharedModule,
    StatisticsDashboardComponent,
    FiltersComponent,
    LoginAttemptsTableComponent,
    SecurityAlertsFiltersComponent,
    PatternDetectionFiltersComponent,
    TimeFilterComponent
  ],
  templateUrl: './login-monitoring.component.html',
  styleUrls: ['./login-monitoring.component.scss']
})
export class LoginMonitoringComponent implements OnInit {
  // Permission state
  hasPermission = false;
  
  // Component references
  filterForm: FormGroup | null = null;
  securityAlertsFilters: SecurityAlertsFilters = {};
  patternDetectionFilters: PatternDetectionFilters = {};
  
  // ViewChild reference to table component for filter triggering
  @ViewChild(LoginAttemptsTableComponent) loginAttemptsTable!: LoginAttemptsTableComponent;
  
  // ViewChild references for pattern tile navigation and filtering
  @ViewChild(MatTabGroup) tabGroup!: MatTabGroup;
  @ViewChild(PatternDetectionFiltersComponent) patternFiltersComponent!: PatternDetectionFiltersComponent;
  
  // Data for tabs that aren't yet refactored
  detectedPatterns: Pattern[] = [];
  securityAlerts: SecurityAlert[] = [];
  selectedIpReputation: IPReputation | null = null;
  
  // Pattern Summary Dashboard Properties
  patternSummary: PatternSummary[] = [];
  currentTimeFilter: TimeFilter = { timeRange: '30d' }; // Default to last 30 days
  
  // Pattern Detection Table Properties - Following login-attempts-table pattern
  patternDisplayedColumns: string[] = [
    'timestamp', 'type', 'severity', 'ipAddresses', 'details', 'groupCount', 'actions'
  ];
  
  // Pattern Pagination Properties - Following login-attempts-table pattern
  patternTotalCount = 0;
  patternPageSize = 10;
  patternCurrentPage = 0;
  
  // Loading states for non-refactored sections
  loading = {
    patterns: false,
    alerts: false,
    ipReputation: false,
    patternSummary: false
  };

  constructor(
    private permissionService: PermissionService,
    private loginMonitoringService: LoginMonitoringService,
    private snackBar: MatSnackBar,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Check permission using resource:action format - following dynamic-access-control rule
    this.permissionService.hasPermission('login-monitoring:read').subscribe(hasPermission => {
      this.hasPermission = hasPermission;
      
      if (hasPermission) {
        this.loadPatterns();
        this.loadSecurityAlerts();
        this.loadPatternSummary();
      } else {
        this.snackBar.open('You do not have permission to view this page.', 'Close', { duration: 5000 });
        this.router.navigate(['/app/dashboard']);
      }
    });
  }

  // Event handlers for child components
  onFiltersChanged(filterForm: FormGroup): void {
    this.filterForm = filterForm;
    
    // BUG-109 FIX: Trigger table refresh when filters change
    if (this.loginAttemptsTable) {
      this.loginAttemptsTable.applyFilters();
    }
  }

  onFiltersReset(): void {
    // Reset handled by filters component
    
    // BUG-109 FIX: Trigger table refresh when filters are reset
    if (this.loginAttemptsTable) {
      this.loginAttemptsTable.applyFilters();
    }
  }

  onStatsLoaded(stats: Statistics): void {
    // Handle stats loaded event if needed
    console.log('Statistics loaded:', stats);
  }

  onAttemptSelected(attempt: LoginAttempt): void {
    // Handle attempt selection
    console.log('Attempt selected:', attempt);
    // Could open a dialog or navigate to detail view
  }

  onIPReputationRequested(ipAddress: string): void {
    this.getIPReputation(ipAddress);
  }

  // Security Alerts Filters Event Handlers
  onSecurityAlertsFiltersChanged(filters: SecurityAlertsFilters): void {
    this.securityAlertsFilters = filters;
    this.loadSecurityAlerts();
  }

  onSecurityAlertsFiltersReset(): void {
    this.securityAlertsFilters = {};
    this.loadSecurityAlerts();
  }

  // Pattern Detection Filters Event Handlers
  onPatternDetectionFiltersChanged(filters: PatternDetectionFilters): void {
    this.patternDetectionFilters = filters;
    this.loadPatterns(filters);
  }

  onPatternDetectionFiltersReset(): void {
    this.patternDetectionFilters = {};
    this.loadPatterns({});
  }

  // Methods for tabs that aren't yet refactored
  // UNIFIED PATTERN LOADING: Single method for all pattern queries
  loadPatterns(filters: PatternDetectionFilters = {}): void {
    if (!this.hasPermission) return;
    
    console.log('[DEBUG] loadPatterns called with filters:', filters);
    this.loading.patterns = true;
    
    this.loginMonitoringService.getPatterns(
      filters,
      this.patternCurrentPage, // Use pagination properties
      this.patternPageSize, // Use pagination properties
      'detectionTimestamp', // sortBy
      'desc' // sortDirection - newest first
    ).subscribe({
        next: (data) => {
          console.log('[DEBUG] Patterns loaded successfully:', data);
          // Handle PaginatedResponse<Pattern> properly - following login-attempts-table pattern
          this.detectedPatterns = data.items || [];
          this.patternTotalCount = data.total || 0;
          this.loading.patterns = false;
        },
        error: (error) => {
        console.error('[DEBUG] Error loading patterns:', error);
        this.snackBar.open('Failed to load patterns', 'Close', { duration: 5000 });
          this.loading.patterns = false;
        }
      });
  }

  // Pattern Pagination Handler - Following login-attempts-table pattern
  onPatternPageChange(event: any): void {
    this.patternCurrentPage = event.pageIndex;
    this.patternPageSize = event.pageSize;
    this.loadPatterns(this.patternDetectionFilters);
  }

  // DEPRECATED METHOD - Kept for backward compatibility during transition
  loadFilteredPatterns(): void {
    // Redirect to unified method with current filters
    this.loadPatterns(this.patternDetectionFilters);
  }

  loadSecurityAlerts(): void {
    if (!this.hasPermission) return;
    
    console.log('[DEBUG] loadSecurityAlerts called with permission:', this.hasPermission);
    console.log('[DEBUG] Security alerts filters:', this.securityAlertsFilters);
    this.loading.alerts = true;
    
    this.loginMonitoringService.getSecurityAlerts(
      this.securityAlertsFilters,
      0, // page
      50, // pageSize - show more alerts by default
      'createdAt', // sortBy
      'desc' // sortDirection - newest first
    ).subscribe({
        next: (data) => {
          console.log('[DEBUG] Security alerts loaded successfully:', data);
          this.securityAlerts = data || [];
          this.loading.alerts = false;
        },
        error: (error) => {
        console.error('[DEBUG] Error loading security alerts:', error);
        this.snackBar.open('Failed to load security alerts', 'Close', { duration: 5000 });
          this.loading.alerts = false;
        }
      });
  }

  getIPReputation(ipAddress: string): void {
    if (!this.hasPermission) return;
    
    this.loading.ipReputation = true;
    
    this.loginMonitoringService.getIPReputation(ipAddress).subscribe({
      next: (data) => {
        this.selectedIpReputation = data;
        this.loading.ipReputation = false;
      },
      error: (error) => {
        console.error('Error loading IP reputation:', error);
        this.snackBar.open('Failed to load IP reputation', 'Close', { duration: 5000 });
        this.loading.ipReputation = false;
      }
    });
  }

  // Utility methods for non-refactored sections
  togglePatternExpansion(pattern: Pattern): void {
    pattern.expanded = !pattern.expanded;
  }

  getPatternTypeClass(pattern: Pattern): string {
    switch (pattern.type.toLowerCase()) {
      case 'brute_force':
        return 'pattern-brute-force';
      case 'distributed_attack':
        return 'pattern-distributed';
      case 'credential_stuffing':
        return 'pattern-credential-stuffing';
      case 'account_switching':
        return 'pattern-account-switching';
      default:
        return 'pattern-default';
    }
  }

  getSeverityColor(severity: string): string {
    switch (severity.toLowerCase()) {
      case 'critical':
        return 'critical';
      case 'high':
        return 'high';
      case 'medium':
        return 'medium';
      case 'low':
        return 'low';
      default:
        return 'default';
    }
  }

  /**
   * Get the number of grouped patterns for display
   * NEW: Shows how many database records are grouped into one display item
   */
  getGroupCount(pattern: Pattern): number {
    // Check if the pattern has grouping information in evidence
    if (pattern.evidence && pattern.evidence.groupedPatternCount) {
      return pattern.evidence.groupedPatternCount;
    }
    // Fallback to displayCount if available
    if (pattern.evidence && pattern.evidence.displayCount) {
      return pattern.evidence.displayCount;
    }
    // Default to 1 if no grouping information
    return 1;
  }

  // Test button methods for TASK-102.2 validation
  testBruteForcePattern(): void {
    if (!this.hasPermission) return;
    
    this.loginMonitoringService.createTestPattern('brute_force').subscribe({
      next: (response) => {
        const message = response.patternsDetected ? 
          `Brute force test created: ${response.patternsDetected} patterns detected` :
          'Brute force test pattern created successfully';
        this.snackBar.open(message, 'Close', { duration: 5000 });
        // FIXED: No setTimeout needed - refresh immediately since backend handles race condition
        this.loadPatterns(this.patternDetectionFilters);
      },
      error: (error) => {
        console.error('Error creating brute force test pattern:', error);
        this.snackBar.open('Failed to create brute force test pattern', 'Close', { duration: 5000 });
      }
    });
  }

  testDistributedAttackPattern(): void {
    if (!this.hasPermission) return;
    
    this.loginMonitoringService.createTestPattern('distributed_attack').subscribe({
      next: (response) => {
        const message = response.patternsDetected ? 
          `Distributed attack test created: ${response.patternsDetected} patterns detected` :
          'Distributed attack test pattern created successfully';
        this.snackBar.open(message, 'Close', { duration: 5000 });
        // FIXED: No setTimeout needed - refresh immediately since backend handles race condition
        this.loadPatterns(this.patternDetectionFilters);
      },
      error: (error) => {
        console.error('Error creating distributed attack test pattern:', error);
        this.snackBar.open('Failed to create distributed attack test pattern', 'Close', { duration: 5000 });
      }
    });
  }

  testCredentialStuffingPattern(): void {
    if (!this.hasPermission) return;
    
    this.loginMonitoringService.createTestPattern('credential_stuffing').subscribe({
      next: (response) => {
        const message = response.patternsDetected ? 
          `Credential stuffing test created: ${response.patternsDetected} patterns detected` :
          'Credential stuffing test pattern created successfully';
        this.snackBar.open(message, 'Close', { duration: 5000 });
        // FIXED: No setTimeout needed - refresh immediately since backend handles race condition
        this.loadPatterns(this.patternDetectionFilters);
      },
      error: (error) => {
        console.error('Error creating credential stuffing test pattern:', error);
        this.snackBar.open('Failed to create credential stuffing test pattern', 'Close', { duration: 5000 });
      }
    });
  }

  testAccountSwitchingPattern(): void {
    if (!this.hasPermission) return;
    
    this.loginMonitoringService.createTestPattern('account_switching').subscribe({
      next: (response) => {
        const message = response.patternsDetected ? 
          `Account switching test created: ${response.patternsDetected} patterns detected` :
          'Account switching test pattern created successfully';
        this.snackBar.open(message, 'Close', { duration: 5000 });
        // FIXED: No setTimeout needed - refresh immediately since backend handles race condition
        this.loadPatterns(this.patternDetectionFilters);
      },
      error: (error) => {
        console.error('Error creating account switching test pattern:', error);
        this.snackBar.open('Failed to create account switching test pattern', 'Close', { duration: 5000 });
      }
    });
  }

  sendTestAlert(): void {
    if (!this.hasPermission) return;
    
    this.loginMonitoringService.sendTestAlert().subscribe({
      next: (response) => {
        this.snackBar.open('Test alert sent successfully', 'Close', { duration: 5000 });
        // Refresh security alerts after test creation
        setTimeout(() => this.loadSecurityAlerts(), 2000);
      },
      error: (error) => {
        console.error('Error sending test alert:', error);
        this.snackBar.open('Failed to send test alert', 'Close', { duration: 5000 });
      }
    });
  }

  clearTestData(): void {
    if (!this.hasPermission) return;
    
    this.loginMonitoringService.clearTestData().subscribe({
      next: (response) => {
        const message = response.patternsDeletedCount ? 
          `Test data cleared: ${response.deletedCount} attempts, ${response.patternsDeletedCount} patterns` :
          'Test data cleared successfully';
        this.snackBar.open(message, 'Close', { duration: 5000 });
        // FIXED: No setTimeout needed - refresh immediately
        this.loadPatterns();
        this.loadSecurityAlerts();
      },
      error: (error) => {
        console.error('Error clearing test data:', error);
        this.snackBar.open('Failed to clear test data', 'Close', { duration: 5000 });
      }
    });
  }

  // Pattern Summary Dashboard Methods
  loadPatternSummary(): void {
    if (!this.hasPermission) return;
    
    console.log('[DEBUG] loadPatternSummary called with timeFilter:', this.currentTimeFilter);
    this.loading.patternSummary = true;
    
    this.loginMonitoringService.getPatternSummary(this.currentTimeFilter).subscribe({
      next: (data) => {
        console.log('[DEBUG] Pattern summary loaded successfully:', data);
        this.patternSummary = data;
        this.loading.patternSummary = false;
      },
      error: (error) => {
        console.error('[DEBUG] Error loading pattern summary:', error);
        this.snackBar.open('Failed to load pattern summary', 'Close', { duration: 5000 });
        this.loading.patternSummary = false;
      }
    });
  }

  onTimeFilterChange(timeFilter: TimeFilter): void {
    console.log('[DEBUG] Time filter changed:', timeFilter);
    this.currentTimeFilter = timeFilter;
    this.loadPatternSummary();
  }

  onPatternTileClick(patternType: string): void {
    console.log('[DEBUG] Pattern tile clicked:', patternType);
    
    // Navigate to Pattern Detection tab (index 1)
    if (this.tabGroup) {
      this.tabGroup.selectedIndex = 1;
    }
    
    // Apply pattern type filter
    if (this.patternFiltersComponent && this.patternFiltersComponent.filterForm) {
      // Set the pattern type filter
      this.patternFiltersComponent.filterForm.patchValue({
        patternType: patternType
      });
      
      // Trigger the filter change manually
      this.patternFiltersComponent.onFiltersChanged();
    } else {
      // Fallback: Set filters directly and load patterns
      this.patternDetectionFilters = {
        ...this.patternDetectionFilters,
        patternType: patternType as 'brute_force' | 'distributed_attack' | 'credential_stuffing' | 'rapid_account_switching' | 'ip_hopping' | 'suspicious_location' | 'time_anomaly'
      };
      this.loadPatterns(this.patternDetectionFilters);
    }
    
    // Show user feedback
    const displayName = this.getPatternDisplayName(patternType);
    this.snackBar.open(`Filtering by ${displayName} patterns`, 'Close', { duration: 3000 });
  }

  getPatternIcon(patternType: string): string {
    const iconMap: { [key: string]: string } = {
      'brute_force': 'security',
      'distributed_attack': 'network_check',
      'credential_stuffing': 'vpn_key',
      'rapid_account_switching': 'swap_horiz',
      'ip_hopping': 'location_on',
      'suspicious_location': 'place',
      'time_anomaly': 'schedule'
    };
    return iconMap[patternType] || 'warning';
  }

  getPatternDisplayName(patternType: string): string {
    const nameMap: { [key: string]: string } = {
      'brute_force': 'Brute Force',
      'distributed_attack': 'Distributed Attack',
      'credential_stuffing': 'Credential Stuffing',
      'rapid_account_switching': 'Account Switching',
      'ip_hopping': 'IP Hopping',
      'suspicious_location': 'Suspicious Location',
      'time_anomaly': 'Time Anomaly'
    };
    return nameMap[patternType] || patternType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
} 