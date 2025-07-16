import { Component, OnInit, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { LoginMonitoringSharedModule } from '../shared/login-monitoring-shared.module';
import { PatternDetectionFilters } from '../shared/login-monitoring.models';

@Component({
  selector: 'app-pattern-detection-filters',
  standalone: true,
  imports: [LoginMonitoringSharedModule],
  templateUrl: './pattern-detection-filters.component.html',
  styleUrls: ['./pattern-detection-filters.component.scss']
})
export class PatternDetectionFiltersComponent implements OnInit, OnChanges, OnDestroy {
  @Input() hasPermission = false;
  @Input() initialFilters: PatternDetectionFilters | null = null; // BUG-124.19 FIX: Accept initial filters from parent
  @Input() preventInitialEmission = true; // BUG-124.19 FIX: Allow parent to control initial emission
  @Output() filtersChanged = new EventEmitter<PatternDetectionFilters>();
  @Output() filtersReset = new EventEmitter<void>();

  filterForm: FormGroup;
  private destroy$ = new Subject<void>();
  private componentReady = false; // BUG-124.19 FIX: Track when component is fully ready

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
    console.log('[PatternDetectionFilters] Initializing with:', {
      initialFilters: this.initialFilters,
      hasPermission: this.hasPermission
    });
    
    // BUG-124.19 FIX: Apply initial filters from parent if provided
    if (this.initialFilters) {
      this.applyInitialFilters(this.initialFilters);
    }

    // Set initial disabled state
    this.updateFormDisabledState();

    // BUG-124.19 FIX: Set up subscriptions with proper guards
    this.setupSubscriptions();
    
    // Mark component as ready after initialization
    setTimeout(() => {
      this.componentReady = true;
      
      // BUG-FIX: ALWAYS emit initial filters like login-attempts pattern (removed preventInitialEmission logic)
      if (this.hasPermission) {
        console.log('[PatternDetectionFilters] Emitting initial filters with default 7-day range');
        this.onFiltersChanged();
      } else {
        console.log('[PatternDetectionFilters] Initial emission skipped - no permission');
      }
    }, 150); // Slightly longer delay than time filter to ensure proper initialization order
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Update form disabled state when hasPermission changes
    if (changes['hasPermission'] && this.filterForm) {
      this.updateFormDisabledState();
    }
    
    // BUG-124.19 FIX: Apply new initial filters from parent
    if (changes['initialFilters'] && this.componentReady && this.initialFilters) {
      console.log('[PatternDetectionFilters] Applying new filters from parent:', this.initialFilters);
      this.applyInitialFilters(this.initialFilters);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private createFilterForm(): FormGroup {
    // BUG-FIX: Default date range (last 7 days) to match login-attempts pattern
    const defaultDateTo = new Date();
    const defaultDateFrom = new Date();
    defaultDateFrom.setDate(defaultDateFrom.getDate() - 7);
    
    return this.fb.group({
      status: [{ value: '', disabled: !this.hasPermission }],
      patternType: [{ value: '', disabled: !this.hasPermission }],
      severity: [{ value: '', disabled: !this.hasPermission }],
      ipAddress: [{ value: '', disabled: !this.hasPermission }],
      dateFrom: [{ value: defaultDateFrom, disabled: !this.hasPermission }], // Default to 7 days ago
      dateTo: [{ value: defaultDateTo, disabled: !this.hasPermission }],      // Default to today
      search: [{ value: '', disabled: !this.hasPermission }]
    });
  }

  // BUG-124.19 FIX: Apply initial filters without emitting changes
  private applyInitialFilters(filters: PatternDetectionFilters): void {
    console.log('[PatternDetectionFilters] Applying initial filters:', filters);
    
    // Convert filters to form values
    const formValues: any = {
      status: filters.status || '',
      patternType: filters.patternType || '',
      severity: filters.severity || '',
      ipAddress: filters.ipAddress || '',
      search: filters.search || ''
    };
    
    // Handle date filters
    if (filters.dateFrom) {
      formValues.dateFrom = new Date(filters.dateFrom);
    }
    if (filters.dateTo) {
      formValues.dateTo = new Date(filters.dateTo);
    }
    
    // Apply values without emitting events
    this.filterForm.patchValue(formValues, { emitEvent: false });
  }

  private setupSubscriptions(): void {
    // BUG-124.19 FIX: Subscribe to form changes with proper guards
    this.filterForm.valueChanges.pipe(
      debounceTime(300), // Wait 300ms after user stops typing
      distinctUntilChanged(), // Only emit when values actually change
      takeUntil(this.destroy$) // Unsubscribe when component is destroyed
    ).subscribe(values => {
      if (this.componentReady && this.hasPermission) {
        console.log('[PatternDetectionFilters] Form values changed:', values);
        this.onFiltersChanged();
      }
    });
  }

  private updateFormDisabledState(): void {
    if (this.hasPermission) {
      this.filterForm.enable();
    } else {
      this.filterForm.disable();
    }
  }

  onFiltersChanged(): void {
    if (!this.hasPermission || !this.componentReady) {
      console.log('[PatternDetectionFilters] Filters change ignored - no permission or not ready');
      return;
    }

    console.log('[PatternDetectionFilters] Apply Filters button clicked - processing filters');

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

    console.log('[PatternDetectionFilters] Emitting filters:', filters);
    this.filtersChanged.emit(filters);
  }

  onReset(): void {
    if (!this.hasPermission || !this.componentReady) {
      console.log('[PatternDetectionFilters] Reset ignored - no permission or not ready');
      return;
    }

    console.log('[PatternDetectionFilters] Resetting filters to default 30-day range');
    
    // Reset form to default values (30-day range to match parent)
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    this.filterForm.reset({
      status: '',
      patternType: '',
      severity: '',
      ipAddress: '',
      dateFrom: thirtyDaysAgo,
      dateTo: today,
      search: ''
    });

    this.filtersReset.emit();
  }

  onClear(): void {
    if (!this.hasPermission || !this.componentReady) {
      console.log('[PatternDetectionFilters] Clear ignored - no permission or not ready');
      return;
    }

    console.log('[PatternDetectionFilters] Clearing all filters');

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

  // Enhanced form submission prevention with debugging
  onFormSubmit(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    console.log('[PatternDetectionFilters] Form submission prevented - this should not cause navigation');
  }

  // BUG-FIX: Public method for parent to trigger refresh (matching login-attempts pattern)
  public refreshWithFilters(): void {
    console.log('[PatternDetectionFilters] refreshWithFilters called');
    this.onApplyFiltersClick();
  }

  // Explicit button click handler to prevent any form submission behavior
  onApplyFiltersClick(): void {
    console.log('[PatternDetectionFilters] Apply filters clicked');
    if (this.hasPermission && this.componentReady) {
      this.onApplyFilters();
    }
  }

  onApplyFilters(): void {
    console.log('[PatternDetectionFilters] onApplyFilters called');
    // BUG-124.19 FIX: Add guards to prevent emission when not ready
    if (!this.componentReady || !this.hasPermission) {
      console.log('[PatternDetectionFilters] Not ready or no permission, skipping filter application');
      return;
    }
    
    this.onFiltersChanged();
  }

  onResetFilters(): void {
    console.log('[PatternDetectionFilters] onResetFilters called');
    // BUG-124.19 FIX: Add guards to prevent emission when not ready
    if (!this.componentReady || !this.hasPermission) {
      console.log('[PatternDetectionFilters] Not ready or no permission, skipping filter reset');
      return;
    }
    
    // Reset form to default values (last 7 days)
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
    this.onFiltersChanged();
  }

  // BUG-124.19 FIX: Public method for parent to update filters without emission
  public updateFilters(filters: PatternDetectionFilters, emitChange = false): void {
    if (!this.componentReady) return;
    
    console.log('[PatternDetectionFilters] Filters updated by parent:', filters, 'emit:', emitChange);
    this.applyInitialFilters(filters);
    
    if (emitChange) {
      this.onFiltersChanged();
    }
  }
} 