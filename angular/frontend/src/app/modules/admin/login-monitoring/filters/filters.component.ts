import { Component, OnInit, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { LoginMonitoringSharedModule } from '../shared/login-monitoring-shared.module';

@Component({
  selector: 'app-login-monitoring-filters',
  standalone: true,
  imports: [LoginMonitoringSharedModule],
  templateUrl: './filters.component.html',
  styleUrls: ['./filters.component.scss']
})
export class FiltersComponent implements OnInit, OnChanges {
  @Input() hasPermission = false;
  @Output() filtersChanged = new EventEmitter<FormGroup>();
  @Output() filtersReset = new EventEmitter<void>();

  filterForm: FormGroup;

  constructor(private fb: FormBuilder) {
    this.filterForm = this.createFilterForm();
  }

  ngOnInit(): void {
    // Set initial disabled state
    this.updateFormDisabledState();
    // Emit initial form state with default date range
    this.filtersChanged.emit(this.filterForm);
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Update form disabled state when hasPermission changes
    if (changes['hasPermission'] && this.filterForm) {
      this.updateFormDisabledState();
    }
  }

  private createFilterForm(): FormGroup {
    // BUG-109 ENHANCEMENT: Calculate default date range (last 7 days)
    const defaultDateTo = new Date();
    const defaultDateFrom = new Date();
    defaultDateFrom.setDate(defaultDateFrom.getDate() - 7);
    
    return this.fb.group({
      email: [{ value: '', disabled: !this.hasPermission }],
      ipAddress: [{ value: '', disabled: !this.hasPermission }],
      status: [{ value: '', disabled: !this.hasPermission }],
      dateFrom: [{ value: defaultDateFrom, disabled: !this.hasPermission }], // Default to 7 days ago
      dateTo: [{ value: defaultDateTo, disabled: !this.hasPermission }]      // Default to today
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
      this.filtersChanged.emit(this.filterForm);
    }
  }

  onResetFilters(): void {
    if (this.hasPermission) {
      // Reset to default date range (last 7 days), not null
      const defaultDateTo = new Date();
      const defaultDateFrom = new Date();
      defaultDateFrom.setDate(defaultDateFrom.getDate() - 7);
      
      this.filterForm.reset({
        email: '',
        ipAddress: '',
        status: '',
        dateFrom: defaultDateFrom,
        dateTo: defaultDateTo
      });
      this.filtersReset.emit();
      this.filtersChanged.emit(this.filterForm);
    }
  }

  // Get form control for easy access in template
  get emailControl() { return this.filterForm.get('email'); }
  get ipAddressControl() { return this.filterForm.get('ipAddress'); }
  get statusControl() { return this.filterForm.get('status'); }
  get dateFromControl() { return this.filterForm.get('dateFrom'); }
  get dateToControl() { return this.filterForm.get('dateTo'); }
} 