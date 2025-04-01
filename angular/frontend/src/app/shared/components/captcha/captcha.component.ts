import { Component, OnInit, forwardRef, ChangeDetectorRef } from '@angular/core';
import { 
  ControlValueAccessor, 
  NG_VALUE_ACCESSOR, 
  FormControl, 
  FormGroup, 
  Validators,
  ReactiveFormsModule 
} from '@angular/forms';
import { CaptchaService, CaptchaResult } from '../../../core/services/captcha.service';
import { catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-captcha',
  templateUrl: './captcha.component.html',
  styleUrls: ['./captcha.component.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CaptchaComponent),
      multi: true
    }
  ]
})
export class CaptchaComponent implements OnInit, ControlValueAccessor {
  captchaForm = new FormGroup({
    userInput: new FormControl('', [Validators.required])
  });
  
  captchaData: CaptchaResult | null = null;
  isLoading = false;
  error = '';
  
  private onChange: (value: any) => void = () => {};
  private onTouched: () => void = () => {};
  
  constructor(
    private captchaService: CaptchaService,
    private cdr: ChangeDetectorRef
  ) {}
  
  ngOnInit(): void {
    this.refreshCaptcha();
    
    // Subscribe to form changes to propagate value
    this.captchaForm.get('userInput')?.valueChanges.subscribe(value => {
      // Pass the complete data needed for verification
      if (this.captchaData?.captchaId) {
        this.onChange({
          captchaId: this.captchaData.captchaId,
          userInput: value
        });
      } else {
        this.onChange(null);
      }
    });
  }
  
  refreshCaptcha(): void {
    this.isLoading = true;
    this.error = '';
    
    this.captchaService.generateCaptcha()
      .pipe(
        catchError(error => {
          console.error('Error loading captcha:', error);
          this.error = 'Failed to load CAPTCHA. Please try again.';
          return of(null);
        }),
        finalize(() => {
          this.isLoading = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe(result => {
        if (result) {
          this.captchaData = result;
          this.captchaForm.get('userInput')?.setValue('');
        }
      });
  }
  
  // ControlValueAccessor methods
  writeValue(value: any): void {
    // Handle setting the form value if needed
    if (value && typeof value === 'string') {
      this.captchaForm.get('userInput')?.setValue(value, { emitEvent: false });
    }
  }
  
  registerOnChange(fn: any): void {
    this.onChange = fn;
  }
  
  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }
  
  setDisabledState(isDisabled: boolean): void {
    if (isDisabled) {
      this.captchaForm.disable();
    } else {
      this.captchaForm.enable();
    }
  }
  
  // Helper getter for the template
  get userInput() {
    return this.captchaForm.get('userInput');
  }
  
  // For validation in parent component
  validate(): boolean {
    return this.captchaForm.valid && !!this.captchaData?.captchaId;
  }
  
  // Return the CAPTCHA data for validation
  getCaptchaData(): { captchaId: string; userInput: string } | null {
    if (!this.captchaData?.captchaId || !this.userInput?.value) {
      return null;
    }
    
    return {
      captchaId: this.captchaData.captchaId,
      userInput: this.userInput.value
    };
  }
  
  // Mark form as touched for validation
  markAsTouched(): void {
    this.onTouched();
    this.captchaForm.markAllAsTouched();
  }
} 