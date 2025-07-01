import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { LoginMonitoringSharedModule } from '../shared/login-monitoring-shared.module';
import { PatternDetectionFilters } from '../shared/login-monitoring.models';

@Component({
  selector: 'app-pattern-detection-filters',
  standalone: true,
  imports: [LoginMonitoringSharedModule],
  templateUrl: './pattern-detection-filters.component.html',
  styleUrls: ['./pattern-detection-filters.component.scss']
})
export class PatternDetectionFiltersComponent implements OnInit {
  @Input() hasPermission = false;
  @Output() filtersChanged = new EventEmitter<PatternDetectionFilters>();
  @Output() filtersReset = new EventEmitter<void>();

  filterForm: FormGroup;

  // Filter Options
  statusOptions = [
    { value: '', label: 'All Statuses' },
    { value: 'active', label: 'Active' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'dismissed', label: 'Dismissed' }
  ];

  patternTypeOptions = [
    { value: '', label: 'All Pattern Types' },
    { value: 'brute_force', label: 'Brute Force' },
    { value: 'distributed_attack', label: 'Distributed Attack' },
    { value: 'credential_stuffing', label: 'Credential Stuffing' },
    { value: 'rapid_account_switching', label: 'Rapid Account Switching' },
    { value: 'ip_hopping', label: 'IP Hopping' },
    { value: 'suspicious_location', label: 'Suspicious Location' },
    { value: 'time_anomaly', label: 'Time Anomaly' }
  ];

  severityOptions = [
    { value: '', label: 'All Severities' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'critical', label: 'Critical' }
  ];

  constructor(private fb: FormBuilder) {
    this.filterForm = this.createFilterForm();
  }

  ngOnInit(): void {
    // Set default date range (last 7 days)
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 7);
    
    this.filterForm.patchValue({
      dateFrom: sevenDaysAgo,
      dateTo: today
    });

    // Subscribe to form changes
    this.filterForm.valueChanges.subscribe(values => {
      if (this.hasPermission) {
        this.onFiltersChanged();
      }
    });
  }

  private createFilterForm(): FormGroup {
    return this.fb.group({
      status: [''],
      patternType: [''],
      severity: [''],
      ipAddress: [''],
      dateFrom: [null],
      dateTo: [null],
      search: ['']
    });
  }

  onFiltersChanged(): void {
    if (!this.hasPermission) return;

    const formValues = this.filterForm.value;
    const filters: PatternDetectionFilters = {
      status: formValues.status || undefined,
      patternType: formValues.patternType || undefined,
      severity: formValues.severity || undefined,
      ipAddress: formValues.ipAddress?.trim() || undefined,
      dateFrom: formValues.dateFrom || undefined,
      dateTo: formValues.dateTo || undefined,
      search: formValues.search?.trim() || undefined
    };

    // Remove empty/undefined values
    Object.keys(filters).forEach(key => {
      if (filters[key as keyof PatternDetectionFilters] === undefined || 
          filters[key as keyof PatternDetectionFilters] === '') {
        delete filters[key as keyof PatternDetectionFilters];
      }
    });

    this.filtersChanged.emit(filters);
  }

  onReset(): void {
    if (!this.hasPermission) return;

    // Reset form to default values
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 7);
    
    this.filterForm.reset({
      status: '',
      patternType: '',
      severity: '',
      ipAddress: '',
      dateFrom: sevenDaysAgo,
      dateTo: today,
      search: ''
    });

    this.filtersReset.emit();
  }

  onClear(): void {
    if (!this.hasPermission) return;

    this.filterForm.reset({
      status: '',
      patternType: '',
      severity: '',
      ipAddress: '',
      dateFrom: null,
      dateTo: null,
      search: ''
    });

    this.filtersReset.emit();
  }
} 