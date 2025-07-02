import { Component, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSort, Sort } from '@angular/material/sort';
import { Router } from '@angular/router';
import { PermissionService } from '../../../core/services/permission.service';
import { LoginMonitoringSharedModule } from './shared/login-monitoring-shared.module';
import { StatisticsDashboardComponent } from './statistics-dashboard/statistics-dashboard.component';
import { FiltersComponent } from './filters/filters.component';
import { LoginAttemptsTableComponent } from './login-attempts-table/login-attempts-table.component';
import { SecurityAlertsFiltersComponent } from './security-alerts-filters/security-alerts-filters.component';
import { PatternDetectionFiltersComponent } from './pattern-detection-filters/pattern-detection-filters.component';
import { LoginMonitoringService } from './shared/login-monitoring.service';
import {
  LoginAttempt,
  Statistics, 
  Pattern,
  SecurityAlert, 
  SecurityAlertsFilters,
  PatternDetectionFilters,
  IPReputation
} from './shared/login-monitoring.models';

@Component({
  selector: 'app-login-monitoring',
  standalone: true,
  imports: [
    LoginMonitoringSharedModule,
    StatisticsDashboardComponent,
    FiltersComponent,
    LoginAttemptsTableComponent,
    SecurityAlertsFiltersComponent,
    PatternDetectionFiltersComponent
  ],
  templateUrl: './login-monitoring.component.html',
  styleUrls: ['./login-monitoring.component.scss']
})
export class LoginMonitoringComponent implements OnInit, AfterViewInit {
  hasPermission = false;
  filterForm: FormGroup | null = null;
  securityAlertsFilters: SecurityAlertsFilters = {};
  patternDetectionFilters: PatternDetectionFilters = {};
  
  @ViewChild(LoginAttemptsTableComponent) loginAttemptsTable!: LoginAttemptsTableComponent;
  @ViewChild('patternSort') patternSort!: MatSort;
  
  detectedPatterns: Pattern[] = [];
  securityAlerts: SecurityAlert[] = [];
  selectedIpReputation: IPReputation | null = null;
  
  // Pattern pagination properties
  patternTotalCount = 0;
  patternPageSize = 10;
  patternCurrentPage = 0;
  patternDisplayedColumns: string[] = ['timestamp', 'type', 'severity', 'ipAddresses', 'details', 'groupCount', 'actions'];
  
  // Loading states for non-refactored sections
  loading = {
    attempts: false,
    patterns: false,
    alerts: false,
    ipReputation: false
  };

  private shouldInitializePatternSort = false;
  private patternSortInitialized = false;

  constructor(
    private permissionService: PermissionService,
    private loginMonitoringService: LoginMonitoringService,
    private snackBar: MatSnackBar,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.permissionService.hasPermission('login-monitoring:read').subscribe(hasPermission => {
      this.hasPermission = hasPermission;
      
      if (hasPermission) {
        this.shouldInitializePatternSort = true;
        this.loadSecurityAlerts();
        
        if (this.patternSort) {
          this.initializePatternSort();
          this.loadPatterns();
        }
      } else {
        this.snackBar.open('You do not have permission to view this page.', 'Close', { duration: 5000 });
        this.router.navigate(['/app/dashboard']);
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.shouldInitializePatternSort && !this.patternSortInitialized) {
      this.initializePatternSort();
      this.loadPatterns();
    }
  }

  private initializePatternSort(): void {
    if (this.patternSortInitialized || !this.patternSort || !this.hasPermission) {
      return;
    }
    
    this.patternSortInitialized = true;
    
    if (this.patternSort.active && this.patternSort.direction) {
      this.patternCurrentSort = {
        active: this.patternSort.active,
        direction: this.patternSort.direction
      };
    }
    
    this.patternSort.sortChange.subscribe(() => {
      this.patternCurrentPage = 0;
      if (this.patternSort.active && this.patternSort.direction) {
        this.patternCurrentSort = {
          active: this.patternSort.active,
          direction: this.patternSort.direction
        };
      }
      this.loadPatterns();
    });
  }

  onFiltersChanged(filterForm: FormGroup): void {
    this.filterForm = filterForm;
    if (this.loginAttemptsTable) {
      this.loginAttemptsTable.applyFilters();
    }
  }

  onFiltersReset(): void {
    if (this.loginAttemptsTable) {
      this.loginAttemptsTable.applyFilters();
    }
  }

  onStatsLoaded(stats: Statistics): void {
    console.log('Statistics loaded:', stats);
  }

  onAttemptSelected(attempt: LoginAttempt): void {
    console.log('Attempt selected:', attempt);
  }

  onIPReputationRequested(ipAddress: string): void {
    this.getIPReputation(ipAddress);
  }

  onSecurityAlertsFiltersChanged(filters: SecurityAlertsFilters): void {
    this.securityAlertsFilters = filters;
    this.loadSecurityAlerts();
  }

  onSecurityAlertsFiltersReset(): void {
    this.securityAlertsFilters = {};
    this.loadSecurityAlerts();
  }

  onPatternDetectionFiltersChanged(filters: PatternDetectionFilters): void {
    this.patternDetectionFilters = filters;
    this.patternCurrentPage = 0;
    this.loadPatterns();
  }

  onPatternDetectionFiltersReset(): void {
    this.patternDetectionFilters = {};
    this.patternCurrentPage = 0;
    this.loadPatterns();
  }

  loadPatterns(): void {
    if (!this.hasPermission) return;
    
    this.loading.patterns = true;
    
    this.loginMonitoringService.getPatterns(
      this.patternDetectionFilters,
      this.patternCurrentPage,
      this.patternPageSize,
      this.getPatternSortField(this.patternCurrentSort.active),
      this.patternCurrentSort.direction
    ).subscribe({
      next: (response) => {
        this.detectedPatterns = response.items || [];
        this.patternTotalCount = response.total || 0;
        this.loading.patterns = false;
      },
      error: (error) => {
        console.error('Error loading patterns:', error);
        this.snackBar.open('Failed to load patterns', 'Close', { duration: 5000 });
        this.loading.patterns = false;
      }
    });
  }

  private getPatternSortField(sortHeaderId: string): string {
    const fieldMapping: { [key: string]: string } = {
      'timestamp': 'detectionTimestamp',
      'detectionTimestamp': 'detectionTimestamp',
      'type': 'patternType',
      'patternType': 'patternType',
      'severity': 'severity',
      'ipAddresses': 'ipAddress',
      'ipAddress': 'ipAddress',
      'details': 'details',
      'id': 'id'
    };
    
    return fieldMapping[sortHeaderId] || sortHeaderId;
  }

  onPatternPageChange(event: any): void {
    this.patternCurrentPage = event.pageIndex;
    this.patternPageSize = event.pageSize;
    this.loadPatterns(this.patternDetectionFilters);
  }

  loadSecurityAlerts(): void {
    if (!this.hasPermission) return;
    
    this.loading.alerts = true;
    
    this.loginMonitoringService.getSecurityAlerts(
      this.securityAlertsFilters,
      0,
      50,
      'createdAt',
      'desc'
    ).subscribe({
        next: (data) => {
          this.securityAlerts = data || [];
          this.loading.alerts = false;
        },
        error: (error) => {
        console.error('Error loading security alerts:', error);
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

  getSeverityClass(severity: string): string {
    switch (severity.toLowerCase()) {
      case 'low':
        return 'severity-low';
      case 'medium':
        return 'severity-medium';
      case 'high':
        return 'severity-high';
      case 'critical':
        return 'severity-critical';
      default:
        return 'severity-unknown';
    }
  }

  getGroupCount(pattern: Pattern): number {
    if (pattern.evidence && pattern.evidence.groupedPatternCount) {
      return pattern.evidence.groupedPatternCount;
    }
    return 1;
  }

  testBruteForcePattern(): void {
    if (!this.hasPermission) return;
    
    this.loginMonitoringService.createTestPattern('brute_force').subscribe({
      next: (response) => {
        const message = response.patternsDetected ? 
          `Brute force test created: ${response.patternsDetected} patterns detected` :
          'Brute force test pattern created successfully';
        this.snackBar.open(message, 'Close', { duration: 5000 });
        this.loadPatterns();
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
        this.loadPatterns();
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
        this.loadPatterns();
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
        this.loadPatterns();
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
        this.loadPatterns();
        this.loadSecurityAlerts();
      },
      error: (error) => {
        console.error('Error clearing test data:', error);
        this.snackBar.open('Failed to clear test data', 'Close', { duration: 5000 });
      }
    });
  }
} 