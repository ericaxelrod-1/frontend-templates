import { Component, OnInit, forwardRef, ChangeDetectorRef, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import { CaptchaService, CaptchaResult } from '../../../../core/services/captcha.service';
import { LoggerService } from '../../../../services/logging/logger.service';

@Component({
  selector: 'app-standard-captcha',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => StandardCaptchaComponent),
      multi: true
    }
  ],
  template: `
    <div class="standard-captcha">
      <div *ngIf="loading" class="captcha-loading">
        Loading challenge...
      </div>
      
      <div *ngIf="!loading && captcha" class="captcha-content">
        <div class="challenge-display">
          <img *ngIf="captcha.type === 'image'" [src]="captcha.challenge" alt="CAPTCHA Challenge" class="captcha-image">
          <div *ngIf="captcha.type !== 'image'" class="captcha-text">{{ captcha.challenge }}</div>
          
          <button type="button" class="refresh-btn" (click)="refreshChallenge()" title="Get a new challenge">
            <span aria-hidden="true">↻</span>
          </button>
        </div>
        
        <div class="solution-input">
          <label for="captchaSolution">Enter characters above:</label>
          <input 
            id="captchaSolution"
            type="text" 
            [(ngModel)]="solution" 
            (input)="onSolutionChange()"
            [disabled]="disabled"
            autocomplete="off"
            spellcheck="false"
            class="form-control">
        </div>
      </div>
      
      <div *ngIf="!loading && !captcha" class="captcha-error">
        Failed to load CAPTCHA. <button (click)="refreshChallenge()">Try again</button>
      </div>
    </div>
  `,
  styles: [`
    .standard-captcha {
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 12px;
      background-color: #fcfcfc;
      margin-bottom: 15px;
    }
    
    .challenge-display {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    
    .captcha-image {
      max-width: 200px;
      height: 60px;
      border: 1px solid #ccc;
      border-radius: 4px;
    }
    
    .captcha-text {
      font-size: 1.5rem;
      font-weight: bold;
      letter-spacing: 3px;
      padding: 10px;
      background: #eee;
      border-radius: 4px;
      border: 1px dashed #999;
    }
    
    .refresh-btn {
      background: #f0f0f0;
      border: 1px solid #ccc;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }
    
    .refresh-btn:hover {
      background: #e0e0e0;
    }
    
    .solution-input label {
      display: block;
      margin-bottom: 5px;
      font-size: 0.85rem;
      color: #666;
    }
    
    .form-control {
      width: 100%;
      padding: 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
    }
    
    .captcha-loading, .captcha-error {
      text-align: center;
      padding: 10px;
      font-size: 0.9rem;
      color: #666;
    }
  `]
})
export class StandardCaptchaComponent implements OnInit, ControlValueAccessor {
  captcha: CaptchaResult | null = null;
  solution: string = '';
  loading: boolean = false;
  disabled: boolean = false;
  
  private onChange: any = () => {};
  private onTouched: any = () => {};
  
  constructor(
    private captchaService: CaptchaService,
    private cdr: ChangeDetectorRef,
    private logger: LoggerService
  ) {}
  
  ngOnInit(): void {
    this.refreshChallenge();
  }
  
  refreshChallenge(): void {
    this.loading = true;
    this.captcha = null;
    this.solution = '';
    this.onChange(null);
    this.cdr.detectChanges();
    
    this.captchaService.generateCaptcha().subscribe({
      next: (res) => {
        this.captcha = res;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.logger.error('Failed to generate captcha', err);
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }
  
  onSolutionChange(): void {
    if (this.captcha && this.solution) {
      this.onChange({
        captchaToken: this.captcha.token,
        captchaSolution: this.solution
      });
    } else {
      this.onChange(null);
    }
  }
  
  // ControlValueAccessor methods
  writeValue(value: any): void {
    if (value && value.captchaSolution) {
      this.solution = value.captchaSolution;
    } else {
      this.solution = '';
    }
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
}
