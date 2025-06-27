import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { LoginMonitoringSharedModule } from '../shared/login-monitoring-shared.module';

@Component({
  selector: 'app-login-monitoring-filters',
  standalone: true,
  imports: [LoginMonitoringSharedModule],
  templateUrl: './filters.component.html',
  styleUrls: ['./filters.component.scss']
})
export class FiltersComponent implements OnInit {
  @Input() hasPermission = false;
  @Output() filtersChanged = new EventEmitter<FormGroup>();
  @Output() filtersReset = new EventEmitter<void>();

  filterForm: FormGroup;

  constructor(private fb: FormBuilder) {
    this.filterForm = this.fb.group({
      email: [''],
      ipAddress: [''],
      status: [''],
      dateFrom: [null],
      dateTo: [null]
    });
  }

  ngOnInit(): void {
    // Emit initial form state
    this.filtersChanged.emit(this.filterForm);
  }

  onApplyFilters(): void {
    if (this.hasPermission) {
      this.filtersChanged.emit(this.filterForm);
    }
  }

  onResetFilters(): void {
    if (this.hasPermission) {
      this.filterForm.reset({
        email: '',
        ipAddress: '',
        status: '',
        dateFrom: null,
        dateTo: null
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