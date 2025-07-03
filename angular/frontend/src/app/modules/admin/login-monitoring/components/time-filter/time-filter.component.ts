import { Component, EventEmitter, Output, OnInit, Input } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';
import { TimeFilter } from '../../../../../models/pattern-summary.interface';

@Component({
  selector: 'app-time-filter',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatDatepickerModule,
    MatInputModule,
    MatNativeDateModule
  ],
  templateUrl: './time-filter.component.html',
  styleUrls: ['./time-filter.component.scss']
})
export class TimeFilterComponent implements OnInit {
  @Input() hasPermission = false;
  @Output() timeFilterChange = new EventEmitter<TimeFilter>();

  timeFilterForm: FormGroup;
  
  predefinedRanges = [
    { value: '24h', label: 'Last 24 Hours' },
    { value: '7d', label: 'Last 7 Days' },
    { value: '30d', label: 'Last 30 Days' },
    { value: '90d', label: 'Last 90 Days' },
    { value: 'all', label: 'All Time' },
    { value: 'custom', label: 'Custom Range' }
  ];

  constructor() {
    this.timeFilterForm = new FormGroup({
      timeRange: new FormControl('30d'), // Default to 30 days
      dateFrom: new FormControl(null),
      dateTo: new FormControl(null)
    });
  }

  ngOnInit(): void {
    // Emit initial filter on component load
    this.onTimeRangeChange();

    // Listen for time range changes
    this.timeFilterForm.get('timeRange')?.valueChanges.subscribe(() => {
      this.onTimeRangeChange();
    });

    // Listen for custom date changes
    this.timeFilterForm.get('dateFrom')?.valueChanges.subscribe(() => {
      if (this.timeFilterForm.get('timeRange')?.value === 'custom') {
        this.emitTimeFilter();
      }
    });

    this.timeFilterForm.get('dateTo')?.valueChanges.subscribe(() => {
      if (this.timeFilterForm.get('timeRange')?.value === 'custom') {
        this.emitTimeFilter();
      }
    });
  }

  onTimeRangeChange(): void {
    const timeRange = this.timeFilterForm.get('timeRange')?.value;
    
    if (timeRange === 'custom') {
      // Enable custom date inputs
      this.timeFilterForm.get('dateFrom')?.enable();
      this.timeFilterForm.get('dateTo')?.enable();
      
      // Only emit if both dates are selected
      if (this.timeFilterForm.get('dateFrom')?.value && this.timeFilterForm.get('dateTo')?.value) {
        this.emitTimeFilter();
      }
    } else {
      // Disable custom date inputs and clear them
      this.timeFilterForm.get('dateFrom')?.disable();
      this.timeFilterForm.get('dateTo')?.disable();
      this.timeFilterForm.get('dateFrom')?.setValue(null);
      this.timeFilterForm.get('dateTo')?.setValue(null);
      
      // Emit predefined range
      this.emitTimeFilter();
    }
  }

  private emitTimeFilter(): void {
    const timeRange = this.timeFilterForm.get('timeRange')?.value;
    
    if (timeRange === 'custom') {
      const dateFrom = this.timeFilterForm.get('dateFrom')?.value;
      const dateTo = this.timeFilterForm.get('dateTo')?.value;
      
      if (dateFrom && dateTo) {
        this.timeFilterChange.emit({
          dateFrom: new Date(dateFrom),
          dateTo: new Date(dateTo)
        });
      }
    } else {
      this.timeFilterChange.emit({
        timeRange: timeRange as '24h' | '7d' | '30d' | '90d' | 'all'
      });
    }
  }

  isCustomRangeSelected(): boolean {
    return this.timeFilterForm.get('timeRange')?.value === 'custom';
  }

  isCustomRangeValid(): boolean {
    if (!this.isCustomRangeSelected()) {
      return true;
    }
    
    const dateFrom = this.timeFilterForm.get('dateFrom')?.value;
    const dateTo = this.timeFilterForm.get('dateTo')?.value;
    
    return !!(dateFrom && dateTo && new Date(dateFrom) <= new Date(dateTo));
  }
} 