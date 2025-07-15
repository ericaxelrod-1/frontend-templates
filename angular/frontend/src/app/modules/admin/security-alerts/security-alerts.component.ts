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
import { SecurityAlertsFiltersComponent } from '../login-monitoring/security-alerts-filters/security-alerts-filters.component';
import { SecurityAlert, SecurityAlertsFilters } from '../login-monitoring/shared/login-monitoring.models';

@Component({
  selector: 'app-security-alerts',
  templateUrl: './security-alerts.component.html',
  styleUrls: ['./security-alerts.component.scss'],
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
    SecurityAlertsFiltersComponent
  ]
})
export class SecurityAlertsComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  private destroy$ = new Subject<void>();
  
  // Permission management
  hasPermission = false;
  loading = false;
  
  // Data properties
  securityAlerts: SecurityAlert[] = [];
  securityAlertsTotalCount = 0;
  securityAlertsPageSize = 10;
  
  // Filter state
  filterState: SecurityAlertsFilters = {
    status: '',
    severity: '',
    alertType: '',
    dateFrom: undefined,
    dateTo: undefined,
    search: ''
  };
  
  // Sorting state
  securityAlertsCurrentSort = {
    column: 'createdAt',
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
        this.onSecurityAlertsSortChange();
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
        }
      });
  }

  private loadData(): void {
    this.loading = true;

    this.loginMonitoringService.getSecurityAlerts(
      this.filterState,
      0,
      this.securityAlertsPageSize,
      this.securityAlertsCurrentSort.column,
      this.securityAlertsCurrentSort.direction
    ).pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (alerts: SecurityAlert[]) => {
        this.securityAlerts = alerts;
        this.securityAlertsTotalCount = alerts.length; // Service doesn't return total count
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading security alerts:', error);
        this.loading = false;
      }
    });
  }

  // Event handlers
  onSecurityAlertsFiltersChanged(filters: SecurityAlertsFilters): void {
    this.filterState = { ...filters };
    this.loadData();
  }

  onSecurityAlertsFiltersReset(): void {
    this.filterState = {
      status: '',
      severity: '',
      alertType: '',
      dateFrom: undefined,
      dateTo: undefined,
      search: ''
    };
    this.loadData();
  }

  onSecurityAlertsSortChange(): void {
    if (this.sort) {
      this.securityAlertsCurrentSort = {
        column: this.sort.active,
        direction: this.sort.direction as 'asc' | 'desc'
      };
      this.loadData();
    }
  }

  onSecurityAlertsPageChange(event: any): void {
    this.securityAlertsPageSize = event.pageSize;
    this.loadData();
  }

  // Utility methods
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

  getStatusClass(status: string): string {
    switch (status?.toLowerCase()) {
      case 'active':
        return 'status-active';
      case 'acknowledged':
        return 'status-acknowledged';
      case 'resolved':
        return 'status-resolved';
      case 'dismissed':
        return 'status-dismissed';
      default:
        return 'status-unknown';
    }
  }

  getAlertIcon(type: string): string {
    switch (type) {
      case 'pattern_brute_force':
        return 'security';
      case 'pattern_credential_stuffing':
        return 'vpn_key';
      case 'auth_login':
        return 'login';
      case 'security_alert':
        return 'warning';
      case 'test_alert':
        return 'bug_report';
      case 'system_alert':
        return 'computer';
      default:
        return 'info';
    }
  }

  getAlertDisplayType(type: string): string {
    switch (type) {
      case 'pattern_brute_force':
        return 'Brute Force Pattern';
      case 'pattern_credential_stuffing':
        return 'Credential Stuffing Pattern';
      case 'auth_login':
        return 'Authentication Login';
      case 'security_alert':
        return 'Security Alert';
      case 'test_alert':
        return 'Test Alert';
      case 'system_alert':
        return 'System Alert';
      default:
        return 'Unknown Alert';
    }
  }

  // Alert action methods
  acknowledgeAlert(alertId: number): void {
    this.loginMonitoringService.acknowledgeAlert(alertId.toString())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadData();
        },
        error: (error) => {
          console.error('Error acknowledging alert:', error);
        }
      });
  }

  resolveAlert(alertId: number): void {
    this.loginMonitoringService.resolveAlert(alertId.toString())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadData();
        },
        error: (error) => {
          console.error('Error resolving alert:', error);
        }
      });
  }

  dismissAlert(alertId: number): void {
    this.loginMonitoringService.dismissAlert(alertId.toString())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadData();
        },
        error: (error) => {
          console.error('Error dismissing alert:', error);
        }
      });
  }

  // Test data methods
  createTestSecurityAlert(): void {
    this.isCreatingTestData = true;
    this.loginMonitoringService.sendTestAlert()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadData();
          this.isCreatingTestData = false;
        },
        error: (error) => {
          console.error('Error creating test security alert:', error);
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
          this.loadData();
          this.isCreatingTestData = false;
        },
        error: (error) => {
          console.error('Error clearing test data:', error);
          this.isCreatingTestData = false;
        }
      });
  }
} 