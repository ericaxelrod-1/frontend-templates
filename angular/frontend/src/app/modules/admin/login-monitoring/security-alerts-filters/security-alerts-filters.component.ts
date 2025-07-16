import { Component, OnInit, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { LoginMonitoringSharedModule } from '../shared/login-monitoring-shared.module';
import { SecurityAlertsFilters } from '../shared/login-monitoring.models';

@Component({
  selector: 'app-security-alerts-filters',
  standalone: true,
  imports: [LoginMonitoringSharedModule],
  templateUrl: './security-alerts-filters.component.html',
  styleUrls: ['./security-alerts-filters.component.scss']
})
export class SecurityAlertsFiltersComponent implements OnInit, OnChanges {
  @Input() hasPermission = false;
  @Output() filtersChanged = new EventEmitter<SecurityAlertsFilters>();
  @Output() filtersReset = new EventEmitter<void>();

  filterForm: FormGroup;
  private componentReady = false; // BUG-124.19 FIX: Track when component is fully ready

  // Filter options based on backend investigation
  statusOptions = [
    { value: '', label: 'All Statuses' },
    { value: 'active', label: 'Active' },
    { value: 'acknowledged', label: 'Acknowledged' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'dismissed', label: 'Dismissed' }
  ];

  severityOptions = [
    { value: '', label: 'All Severities' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'critical', label: 'Critical' }
  ];

  alertTypeOptions = [
    { value: '', label: 'All Alert Types' },
    { value: 'pattern_brute_force', label: 'Brute Force Pattern' },
    { value: 'pattern_credential_stuffing', label: 'Credential Stuffing Pattern' },
    { value: 'auth_login', label: 'Authentication Login' },
    { value: 'security_alert', label: 'Security Alert' },
    { value: 'test_alert', label: 'Test Alert' },
    { value: 'system_alert', label: 'System Alert' }
  ];

  constructor(private fb: FormBuilder) {
    this.filterForm = this.createFilterForm();
  }

  ngOnInit(): void {
    console.log('[SecurityAlertsFilters] Initializing component');
    
    // Set initial disabled state
    this.updateFormDisabledState();
    
    // BUG-124.19 FIX: Mark component as ready after initialization
    setTimeout(() => {
      this.componentReady = true;
      console.log('[SecurityAlertsFilters] Component ready');
      
      // BUG-FIX: ALWAYS emit initial filters like login-attempts pattern
      if (this.hasPermission) {
        console.log('[SecurityAlertsFilters] Emitting initial filters with default 7-day range');
        this.emitFilters();
      } else {
        console.log('[SecurityAlertsFilters] Initial emission skipped - no permission');
      }
    }, 100);
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Update form disabled state when hasPermission changes
    if (changes['hasPermission'] && this.filterForm) {
      this.updateFormDisabledState();
    }
  }

  private createFilterForm(): FormGroup {
    // Default date range (last 7 days) for consistency with login attempts filters
    const defaultDateTo = new Date();
    const defaultDateFrom = new Date();
    defaultDateFrom.setDate(defaultDateFrom.getDate() - 7);
    
    return this.fb.group({
      status: [{ value: '', disabled: !this.hasPermission }],
      severity: [{ value: '', disabled: !this.hasPermission }],
      alertType: [{ value: '', disabled: !this.hasPermission }],
      dateFrom: [{ value: defaultDateFrom, disabled: !this.hasPermission }],
      dateTo: [{ value: defaultDateTo, disabled: !this.hasPermission }],
      search: [{ value: '', disabled: !this.hasPermission }]
    });
  }

  private updateFormDisabledState(): void {
    if (this.hasPermission) {
      this.filterForm.enable();
    } else {
      this.filterForm.disable();
    }
  }

  onApplyFilters(): void {
    console.log('[SecurityAlertsFilters] onApplyFilters called');
    // BUG-124.19 FIX: Add guards to prevent emission when not ready
    if (!this.componentReady || !this.hasPermission) {
      console.log('[SecurityAlertsFilters] Not ready or no permission, skipping filter application');
      return;
    }
    
      this.emitFilters();
  }

  onApplyFiltersClick(): void {
    console.log('[SecurityAlertsFilters] Apply filters clicked');
    if (this.hasPermission && this.componentReady) {
      this.onApplyFilters();
    }
  }

  onFormSubmit(event: Event): void {
    // Prevent form submission which was causing "Form submission canceled" error
    event.preventDefault();
    event.stopPropagation();
    
    // Apply filters on form submission (e.g., when user presses Enter)
    this.onApplyFilters();
  }

  onDateChange(event: any): void {
    // Prevent any navigation or unwanted behavior when date is selected
    if (event && event.preventDefault) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    console.log('[SecurityAlertsFilters] Date changed:', event);
    // The reactive form will handle the value change, no need to emit here
  }

  onDateInput(event: any): void {
    // Prevent any navigation or unwanted behavior when date is manually typed
    if (event && event.preventDefault) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    console.log('[SecurityAlertsFilters] Date input:', event);
    // The reactive form will handle the value change, no need to emit here
  }

  onResetFilters(): void {
    console.log('[SecurityAlertsFilters] onResetFilters called');
    // BUG-124.19 FIX: Add guards to prevent emission when not ready
    if (!this.componentReady || !this.hasPermission) {
      console.log('[SecurityAlertsFilters] Not ready or no permission, skipping filter reset');
      return;
    }
      
    // Reset form to default values (last 7 days)
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 7);
      
      this.filterForm.reset({
        status: '',
        severity: '',
        alertType: '',
      dateFrom: sevenDaysAgo,
      dateTo: today,
        search: ''
      });
      
      this.filtersReset.emit();
      this.emitFilters();
  }

  private emitFilters(): void {
    // BUG-124.19 FIX: Guard against emission before component is ready or without permission
    if (!this.componentReady || !this.hasPermission) {
      console.log('[SecurityAlertsFilters] Emission blocked - not ready or no permission');
      return;
    }

    console.log('[SecurityAlertsFilters] Emitting filters...');
    const formValue = this.filterForm.value;
    const filters: SecurityAlertsFilters = {
      status: formValue.status || undefined,
      severity: formValue.severity || undefined,
      alertType: formValue.alertType || undefined,
      dateFrom: formValue.dateFrom || undefined,
      dateTo: formValue.dateTo || undefined,
      search: formValue.search?.trim() || undefined
    };
    
    this.filtersChanged.emit(filters);
  }

  // Get form controls for easy access in template
  get statusControl() { return this.filterForm.get('status'); }
  get severityControl() { return this.filterForm.get('severity'); }
  get alertTypeControl() { return this.filterForm.get('alertType'); }
  get dateFromControl() { return this.filterForm.get('dateFrom'); }
  get dateToControl() { return this.filterForm.get('dateTo'); }
  get searchControl() { return this.filterForm.get('search'); }

  // BUG-FIX: Public method for parent to trigger refresh (matching login-attempts pattern)
  public refreshWithFilters(): void {
    console.log('[SecurityAlertsFilters] refreshWithFilters called');
    this.onApplyFiltersClick();
  }
} 