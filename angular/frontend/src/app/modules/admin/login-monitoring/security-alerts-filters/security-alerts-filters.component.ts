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
    // Set initial disabled state
    this.updateFormDisabledState();
    // Emit initial form state with default date range
    this.emitFilters();
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
    if (this.hasPermission) {
      this.emitFilters();
    }
  }

  onResetFilters(): void {
    if (this.hasPermission) {
      // Reset to default date range (last 7 days), not null
      const defaultDateTo = new Date();
      const defaultDateFrom = new Date();
      defaultDateFrom.setDate(defaultDateFrom.getDate() - 7);
      
      this.filterForm.reset({
        status: '',
        severity: '',
        alertType: '',
        dateFrom: defaultDateFrom,
        dateTo: defaultDateTo,
        search: ''
      });
      
      this.filtersReset.emit();
      this.emitFilters();
    }
  }

  private emitFilters(): void {
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
} 