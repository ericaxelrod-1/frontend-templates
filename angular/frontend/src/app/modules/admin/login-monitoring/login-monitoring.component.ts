import { Component, OnInit, ViewChild } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { PermissionService } from '../../../core/services/permission.service';
import { LoginMonitoringSharedModule } from './shared/login-monitoring-shared.module';
import { StatisticsDashboardComponent } from './statistics-dashboard/statistics-dashboard.component';
import { FiltersComponent } from './filters/filters.component';
import { LoginAttemptsTableComponent } from './login-attempts-table/login-attempts-table.component';
import { LoginMonitoringService } from './shared/login-monitoring.service';
import { 
  LoginAttempt, 
  Statistics, 
  Pattern, 
  SecurityAlert, 
  IPReputation 
} from './shared/login-monitoring.models';

@Component({
  selector: 'app-login-monitoring',
  standalone: true,
  imports: [
    LoginMonitoringSharedModule,
    StatisticsDashboardComponent,
    FiltersComponent,
    LoginAttemptsTableComponent
  ],
  templateUrl: './login-monitoring.component.html',
  styleUrls: ['./login-monitoring.component.scss']
})
export class LoginMonitoringComponent implements OnInit {
  // Permission state
  hasPermission = false;
  
  // Component references
  filterForm: FormGroup | null = null;
  
  // ViewChild reference to table component for filter triggering
  @ViewChild(LoginAttemptsTableComponent) loginAttemptsTable!: LoginAttemptsTableComponent;
  
  // Data for tabs that aren't yet refactored
  detectedPatterns: Pattern[] = [];
  securityAlerts: SecurityAlert[] = [];
  selectedIpReputation: IPReputation | null = null;
  
  // Loading states for non-refactored sections
  loading = {
    patterns: false,
    alerts: false,
    ipReputation: false
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

  // Methods for tabs that aren't yet refactored
  loadPatterns(): void {
    if (!this.hasPermission) return;
    
    console.log('[DEBUG] loadPatterns called with permission:', this.hasPermission);
    this.loading.patterns = true;
    
    this.loginMonitoringService.detectPatterns().subscribe({
        next: (data) => {
          console.log('[DEBUG] Patterns loaded successfully:', data);
          this.detectedPatterns = data || [];
          this.loading.patterns = false;
        },
        error: (error) => {
        console.error('[DEBUG] Error loading patterns:', error);
        this.snackBar.open('Failed to load patterns', 'Close', { duration: 5000 });
          this.loading.patterns = false;
        }
      });
  }

  loadSecurityAlerts(): void {
    if (!this.hasPermission) return;
    
    console.log('[DEBUG] loadSecurityAlerts called with permission:', this.hasPermission);
    this.loading.alerts = true;
    
    this.loginMonitoringService.getSecurityAlerts().subscribe({
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

  getSeverityClass(severity: string): string {
    switch (severity.toLowerCase()) {
      case 'high':
        return 'severity-high';
      case 'medium':
        return 'severity-medium';
      case 'low':
        return 'severity-low';
      default:
        return 'severity-default';
    }
  }

  // Test button methods for TASK-102.2 validation
  testBruteForcePattern(): void {
    if (!this.hasPermission) return;
    
    this.loginMonitoringService.createTestPattern('brute_force').subscribe({
      next: (response) => {
        this.snackBar.open('Brute force test pattern created successfully', 'Close', { duration: 5000 });
        // Refresh patterns after test creation
        setTimeout(() => this.loadPatterns(), 2000);
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
        this.snackBar.open('Distributed attack test pattern created successfully', 'Close', { duration: 5000 });
        // Refresh patterns after test creation
        setTimeout(() => this.loadPatterns(), 2000);
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
        this.snackBar.open('Credential stuffing test pattern created successfully', 'Close', { duration: 5000 });
        // Refresh patterns after test creation
        setTimeout(() => this.loadPatterns(), 2000);
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
        this.snackBar.open('Account switching test pattern created successfully', 'Close', { duration: 5000 });
        // Refresh patterns after test creation
        setTimeout(() => this.loadPatterns(), 2000);
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
        this.snackBar.open('Test data cleared successfully', 'Close', { duration: 5000 });
        // Refresh both patterns and alerts after clearing
        setTimeout(() => {
          this.loadPatterns();
          this.loadSecurityAlerts();
        }, 1000);
      },
      error: (error) => {
        console.error('Error clearing test data:', error);
        this.snackBar.open('Failed to clear test data', 'Close', { duration: 5000 });
      }
    });
  }
} 