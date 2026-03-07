import { Component, OnInit, OnDestroy, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatCardModule } from '@angular/material/card';
import { LoginAttemptsService } from './shared/login-attempts.service';
import { PageTitleService } from '../../../core/services/page-title.service';
import { PermissionService } from '../../../core/services/permission.service';
import { StatisticsDashboardComponent } from '../login-monitoring/statistics-dashboard/statistics-dashboard.component';
import { LoginAttemptsTableComponent } from '../login-monitoring/login-attempts-table/login-attempts-table.component';
import { FiltersComponent } from '../login-monitoring/filters/filters.component';
import { LoginAttempt, LoginMonitoringFilters, Statistics, PaginatedResponse } from '../login-monitoring/shared/login-monitoring.models';

@Component({
  selector: 'app-login-attempts',
  templateUrl: './login-attempts.component.html',
  styleUrls: ['./login-attempts.component.scss'],
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
    MatCardModule,
    StatisticsDashboardComponent,
    LoginAttemptsTableComponent,
    FiltersComponent
  ]
})
export class LoginAttemptsComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild(LoginAttemptsTableComponent) loginAttemptsTable!: LoginAttemptsTableComponent;
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  private destroy$ = new Subject<void>();

  // Permission management
  hasPermission = false;
  loading = false;
  isCreatingTestData = false;

  // Data properties
  loginAttempts: LoginAttempt[] = [];
  statistics: Statistics | null = null;

  // Filter state and form
  filterState: LoginMonitoringFilters = {
    email: '',
    ipAddress: '',
    status: '',
    dateFrom: undefined,
    dateTo: undefined
  };

  filterForm: FormGroup | null = null;

  constructor(
    private loginAttemptsService: LoginAttemptsService,
    private pageTitleService: PageTitleService,
    private permissionService: PermissionService
  ) { }

  ngOnInit(): void {
    this.pageTitleService.setTitle('Login Attempts');
    this.checkPermissions();
  }

  ngAfterViewInit(): void {
    // Component is ready after view init
    console.log('[LoginAttemptsComponent] ngAfterViewInit - loginAttemptsTable:', this.loginAttemptsTable);
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
      });
  }

  // Event handlers
  onStatsLoaded(stats: Statistics): void {
    this.statistics = stats;
  }

  private ensureTableRefreshes(): void {
    // Ensure ViewChild is available before calling refresh
    if (this.loginAttemptsTable) {
      this.loginAttemptsTable.refreshWithFilters();
    } else {
      // ViewChild not ready yet, try again after a short delay
      setTimeout(() => {
        if (this.loginAttemptsTable) {
          this.loginAttemptsTable.refreshWithFilters();
        } else {
          console.error('[LoginAttemptsComponent] loginAttemptsTable ViewChild not available');
        }
      }, 100);
    }
  }

  onFiltersChanged(filterForm: FormGroup): void {
    console.log('[LoginAttemptsComponent] onFiltersChanged called');
    console.log('[LoginAttemptsComponent] filterForm:', filterForm);
    console.log('[LoginAttemptsComponent] filterForm.value:', filterForm.value);

    this.filterForm = filterForm;
    // Convert FormGroup to LoginMonitoringFilters
    this.filterState = {
      email: filterForm.value.email || '',
      ipAddress: filterForm.value.ipAddress || '',
      status: filterForm.value.status || '',
      dateFrom: filterForm.value.dateFrom,
      dateTo: filterForm.value.dateTo
    };

    console.log('[LoginAttemptsComponent] filterState:', this.filterState);

    // BUG-FIX: Explicitly call the table's refresh method with ViewChild check
    console.log('[LoginAttemptsComponent] Calling table refreshWithFilters');
    this.ensureTableRefreshes();
  }

  onFiltersReset(): void {
    console.log('[LoginAttemptsComponent] onFiltersReset called');

    this.filterState = {
      email: '',
      ipAddress: '',
      status: '',
      dateFrom: undefined,
      dateTo: undefined
    };
    this.filterForm = null;

    // BUG-FIX: Explicitly call the table's refresh method with ViewChild check
    console.log('[LoginAttemptsComponent] Calling table refreshWithFilters for reset');
    this.ensureTableRefreshes();
  }

  onAttemptSelected(attempt: LoginAttempt): void {
    console.log('Login attempt selected:', attempt);
    // Handle attempt selection logic
  }

  onIPReputationRequested(ipAddress: string): void {
    console.log('IP reputation requested for:', ipAddress);
    // Handle IP reputation request logic
  }

  // Test data methods
  createTestLoginAttempt(): void {
    this.isCreatingTestData = true;
    // Note: Test pattern creation moved to PatternDetectionComponent
    // This component focuses on displaying login attempts
    this.isCreatingTestData = false;
    console.log('Test login attempt creation moved to pattern detection component');
  }

  clearTestData(): void {
    // Note: Test data clearing moved to PatternDetectionComponent
    // This component focuses on displaying login attempts
    this.isCreatingTestData = false;
    console.log('Test data clearing moved to pattern detection component');
  }
} 