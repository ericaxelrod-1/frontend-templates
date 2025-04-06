import { Component, OnInit, ViewChild, forwardRef, ChangeDetectorRef, Output, EventEmitter } from '@angular/core';
import { 
  ControlValueAccessor, 
  NG_VALUE_ACCESSOR, 
  ReactiveFormsModule 
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';

// Import all CAPTCHA components
import { VisualReasoningCaptchaComponent } from './visual-reasoning-captcha.component';
import { PhysicalWorldCaptchaComponent } from './physical-world-captcha.component';
import { LoggerService } from '../../../../services/logging/logger.service';

// Define the different types of CAPTCHAs
export enum CaptchaType {
  VISUAL_REASONING = 'visual-reasoning',
  PHYSICAL_WORLD = 'physical-world'
}

@Component({
  selector: 'app-captcha-selector',
  standalone: true,
  imports: [
    CommonModule, 
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatTooltipModule,
    VisualReasoningCaptchaComponent,
    PhysicalWorldCaptchaComponent
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CaptchaSelectorComponent),
      multi: true
    }
  ],
  template: `
    <div class="captcha-selector-container">
      <ng-container [ngSwitch]="selectedCaptchaType">
        <!-- Visual Reasoning CAPTCHA -->
        <app-visual-reasoning-captcha
          *ngSwitchCase="CaptchaType.VISUAL_REASONING"
          #visualCaptcha
          [ngClass]="{ 'is-invalid': touched && !isValid }"
          (valueChange)="onCaptchaValueChange($event)">
        </app-visual-reasoning-captcha>
        
        <!-- Physical World CAPTCHA -->
        <app-physical-world-captcha
          *ngSwitchCase="CaptchaType.PHYSICAL_WORLD"
          #physicalCaptcha
          [ngClass]="{ 'is-invalid': touched && !isValid }"
          (valueChange)="onCaptchaValueChange($event)">
        </app-physical-world-captcha>
      </ng-container>
      
      <!-- Accessibility information -->
      <mat-card class="accessibility-card mat-elevation-z1">
        <button mat-stroked-button 
                color="primary" 
                class="accessibility-button" 
                (click)="selectRandomCaptchaType()" 
                matTooltip="Click to get a different type of CAPTCHA challenge"
                aria-label="Try a different challenge type">
          <mat-icon>refresh</mat-icon>
          Try a different challenge
        </button>
        <div class="info-text">
          <p>This is a CAPTCHA challenge to verify you are human. If you have accessibility needs, you can try a different type of challenge.</p>
        </div>
      </mat-card>
    </div>
  `,
  styles: [`
    .captcha-selector-container {
      margin-bottom: 1rem;
    }
    
    .captcha-selector-container.ng-invalid.ng-touched {
      animation: shake 0.5s;
    }
    
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
      20%, 40%, 60%, 80% { transform: translateX(5px); }
    }
    
    .accessibility-card {
      margin-top: 16px;
      padding: 12px;
      background-color: rgba(66, 66, 66, 0.95);
      color: white;
      border-radius: 4px;
    }
    
    .accessibility-button {
      border-color: rgba(255, 255, 255, 0.3);
      color: #82b1ff !important;
      text-transform: none;
      font-weight: 500;
    }
    
    .accessibility-button:hover {
      background-color: rgba(130, 177, 255, 0.1);
    }
    
    .accessibility-button mat-icon {
      margin-right: 8px;
      font-size: 18px;
      height: 18px;
      width: 18px;
      line-height: 18px;
    }
    
    .info-text {
      margin-top: 12px;
      font-size: 0.85rem;
      color: rgba(255, 255, 255, 0.9);
      line-height: 1.4;
    }
    
    .info-text p {
      margin: 0;
    }
  `]
})
export class CaptchaSelectorComponent implements OnInit, ControlValueAccessor {
  @ViewChild('visualCaptcha') visualCaptcha?: VisualReasoningCaptchaComponent;
  @ViewChild('physicalCaptcha') physicalCaptcha?: PhysicalWorldCaptchaComponent;
  @Output() valueChange = new EventEmitter<any>();
  
  // Expose enum to template
  CaptchaType = CaptchaType;
  
  selectedCaptchaType: CaptchaType = CaptchaType.VISUAL_REASONING;
  value: any = null;
  disabled = false;
  touched = false;
  isValid = false;
  
  private onChange: any = () => {};
  private onTouched: any = () => {};
  
  constructor(
    private cdr: ChangeDetectorRef,
    private logger: LoggerService
  ) {}
  
  ngOnInit(): void {
    // Select a random CAPTCHA type on initialization
    this.selectRandomCaptchaType();
  }
  
  // Randomly select a CAPTCHA type
  selectRandomCaptchaType(): void {
    const types = Object.values(CaptchaType);
    const randomIndex = Math.floor(Math.random() * types.length);
    this.selectedCaptchaType = types[randomIndex] as CaptchaType;
    this.logger.debug('Selected CAPTCHA type:', this.selectedCaptchaType);
    this.cdr.detectChanges();
  }
  
  // Method to handle value changes from child CAPTCHA components
  onCaptchaValueChange(value: any): void {
    this.value = value;
    this.isValid = !!value; // Consider it valid if there's a value
    this.onChange(value);
    this.valueChange.emit(value);
    this.logger.debug('CAPTCHA value changed:', value);
  }
  
  // ControlValueAccessor interface methods
  writeValue(value: any): void {
    this.value = value;
    this.cdr.detectChanges();
  }
  
  registerOnChange(fn: any): void {
    this.onChange = fn;
  }
  
  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }
  
  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    this.cdr.detectChanges();
  }
  
  // Mark the component as touched for validation
  markAsTouched(): void {
    if (!this.touched) {
      this.touched = true;
      this.onTouched();
      this.cdr.detectChanges();
    }
  }
  
  // Method to get the current active CAPTCHA component
  getActiveCaptchaComponent(): any {
    switch (this.selectedCaptchaType) {
      case CaptchaType.VISUAL_REASONING:
        return this.visualCaptcha;
      case CaptchaType.PHYSICAL_WORLD:
        return this.physicalCaptcha;
      default:
        return null;
    }
  }
  
  // Method to get the current CAPTCHA data
  getCaptchaData(): any {
    const component = this.getActiveCaptchaComponent();
    if (!component) return null;
    
    return component.getCaptchaData ? component.getCaptchaData() : null;
  }
} 