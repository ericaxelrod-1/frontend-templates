import { Component, EventEmitter, Output, OnInit, Input, OnDestroy } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';
import { TimeFilter } from '../../../../../models/pattern-summary.interface';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

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
export class TimeFilterComponent implements OnInit, OnDestroy {
  @Input() hasPermission = false;
  @Input() initialTimeRange = '30d'; // BUG-124.19 FIX: Accept initial value from parent
  @Input() preventInitialEmission = true; // BUG-124.19 FIX: Allow parent to control initial emission
  @Output() timeFilterChange = new EventEmitter<TimeFilter>();

  timeFilterForm: FormGroup;
  private isInitialized = false;
  private componentReady = false; // BUG-124.19 FIX: Track when component is fully ready
  private destroy$ = new Subject<void>();
  
  predefinedRanges = [
    { value: '24h', label: 'Last 24 Hours' },
    { value: '7d', label: 'Last 7 Days' },
    { value: '30d', label: 'Last 30 Days' },
    { value: '90d', label: 'Last 90 Days' },
    { value: 'all', label: 'All Time' },
    { value: 'custom', label: 'Custom Range' }
  ];

  constructor() {
    // BUG-124.19 FIX: Use initial value from parent or default
    this.timeFilterForm = new FormGroup({
      timeRange: new FormControl(this.initialTimeRange),
      dateFrom: new FormControl(null),
      dateTo: new FormControl(null)
    });
  }

  ngOnInit(): void {
    console.log('[TimeFilter] Initializing with:', {
      initialTimeRange: this.initialTimeRange,
      preventInitialEmission: this.preventInitialEmission,
      hasPermission: this.hasPermission
    });
    
    // BUG-124.19 FIX: Set form value to parent's initial value
    if (this.initialTimeRange) {
      this.timeFilterForm.patchValue({
        timeRange: this.initialTimeRange
      }, { emitEvent: false }); // Don't emit events during initialization
    }
    
    // Set up subscriptions first
    this.setupSubscriptions();
    
    // Mark as initialized but DON'T emit initial filter to prevent infinite loop
    this.isInitialized = true;
    
    // BUG-124.19 FIX: Only emit initial value if explicitly allowed by parent
    setTimeout(() => {
      this.componentReady = true;
      if (!this.preventInitialEmission) {
        console.log('[TimeFilter] Emitting initial value (not prevented by parent)');
        this.emitTimeFilter();
      } else {
        console.log('[TimeFilter] Initial emission prevented by parent');
      }
    }, 100);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupSubscriptions(): void {
    // Listen for time range changes
    this.timeFilterForm.get('timeRange')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.componentReady) { // BUG-124.19 FIX: Only emit when component is ready
          this.onTimeRangeChange();
        }
      });

    // Listen for custom date changes
    this.timeFilterForm.get('dateFrom')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.componentReady && this.timeFilterForm.get('timeRange')?.value === 'custom') {
          this.emitTimeFilter();
        }
      });

    this.timeFilterForm.get('dateTo')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.componentReady && this.timeFilterForm.get('timeRange')?.value === 'custom') {
          this.emitTimeFilter();
        }
      });
  }

  onTimeRangeChange(): void {
    if (!this.componentReady) {
      console.log('[TimeFilter] Time range change ignored - component not ready');
      return;
    }
    
    const timeRange = this.timeFilterForm.get('timeRange')?.value;
    console.log('[TimeFilter] Time range changed to:', timeRange);
    
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
    // BUG-124.19 FIX: Multiple guards to prevent unwanted emissions
    if (!this.isInitialized || !this.componentReady) {
      console.log('[TimeFilter] Emission prevented - component not ready');
      return;
    }
    
    const timeRange = this.timeFilterForm.get('timeRange')?.value;
    
    if (timeRange === 'custom') {
      const dateFrom = this.timeFilterForm.get('dateFrom')?.value;
      const dateTo = this.timeFilterForm.get('dateTo')?.value;
      
      if (dateFrom && dateTo) {
        console.log('[TimeFilter] Emitting custom range:', { dateFrom, dateTo });
        this.timeFilterChange.emit({
          dateFrom: new Date(dateFrom),
          dateTo: new Date(dateTo)
        });
      }
    } else {
      console.log('[TimeFilter] Emitting predefined range:', timeRange);
      this.timeFilterChange.emit({
        timeRange: timeRange as '24h' | '7d' | '30d' | '90d' | 'all'
      });
    }
  }

  // BUG-124.19 FIX: Public method for parent to trigger emission when needed
  public triggerEmission(): void {
    if (this.componentReady) {
      console.log('[TimeFilter] Manual emission triggered by parent');
      this.emitTimeFilter();
    }
  }

  // BUG-124.19 FIX: Public method for parent to update value without emission
  public updateValue(timeRange: string, emitChange = false): void {
    console.log('[TimeFilter] Value updated by parent:', timeRange, 'emit:', emitChange);
    this.timeFilterForm.patchValue({
      timeRange: timeRange
    }, { emitEvent: emitChange });
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