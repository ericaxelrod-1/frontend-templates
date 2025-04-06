import { Component, OnInit, forwardRef, ChangeDetectorRef } from '@angular/core';
import { 
  ControlValueAccessor, 
  NG_VALUE_ACCESSOR, 
  FormControl, 
  FormGroup, 
  Validators,
  ReactiveFormsModule 
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';

// Interface for physical world understanding option
export interface PhysicalWorldOption {
  id: string;
  imageUrl: string;
  text: string;
  isCorrect: boolean;
}

// Interface for physical world understanding challenge
export interface PhysicalWorldChallenge {
  challengeId: string;
  scenario: string;
  question: string;
  options: PhysicalWorldOption[];
  correctAnswer: string;
  debug?: boolean;
}

@Component({
  selector: 'app-physical-world',
  template: `
    <form [formGroup]="captchaForm" class="physical-world-container">
      <div class="challenge-scenario">
        <h3>{{ challenge?.scenario }}</h3>
        <p>{{ challenge?.question }}</p>
      </div>
      
      <div *ngIf="isLoading" class="captcha-loader">
        <div class="spinner"></div>
      </div>
      
      <div *ngIf="error" class="captcha-error">
        {{ error }}
        <button type="button" class="btn btn-link" (click)="refreshChallenge()">Try again</button>
      </div>
      
      <div *ngIf="!isLoading && !error" class="options-list">
        <div 
          *ngFor="let option of challenge?.options" 
          class="option-item"
          [class.selected]="selectedOptionId === option.id"
          (click)="selectOption(option.id)"
        >
          <div class="option-content">
            <img [src]="option.imageUrl" [alt]="option.text">
            <span class="option-text">{{ option.text }}</span>
          </div>
        </div>
      </div>
      
      <div class="challenge-controls">
        <button 
          type="button"
          class="btn btn-secondary"
          (click)="refreshChallenge()"
          [disabled]="isLoading"
        >
          <span *ngIf="!isLoading">New Challenge</span>
          <span *ngIf="isLoading">Loading...</span>
        </button>
      </div>
      
      <div *ngIf="challenge?.debug" class="debug-info">
        <small>Debug: The correct answer is "{{ challenge?.correctAnswer }}"</small>
      </div>
    </form>
  `,
  styles: [`
    .physical-world-container {
      display: flex;
      flex-direction: column;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 16px;
      margin-bottom: 20px;
    }
    
    .challenge-scenario {
      margin-bottom: 16px;
      text-align: center;
    }
    
    .challenge-scenario h3 {
      margin-bottom: 8px;
    }
    
    .challenge-scenario p {
      color: #555;
    }
    
    .options-list {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      grid-gap: 16px;
      margin-bottom: 16px;
    }
    
    .option-item {
      cursor: pointer;
      border: 1px solid #ddd;
      border-radius: 8px;
      overflow: hidden;
      transition: all 0.2s ease;
      background-color: #f9f9f9;
    }
    
    .option-item:hover {
      transform: translateY(-3px);
      box-shadow: 0 3px 10px rgba(0,0,0,0.1);
    }
    
    .option-item.selected {
      border-color: #007bff;
      background-color: #e8f4ff;
      box-shadow: 0 0 8px rgba(0,123,255,0.5);
    }
    
    .option-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 12px;
    }
    
    .option-content img {
      width: 100%;
      height: 120px;
      object-fit: cover;
      border-radius: 4px;
      margin-bottom: 8px;
    }
    
    .option-text {
      text-align: center;
      font-weight: 500;
    }
    
    .challenge-controls {
      display: flex;
      justify-content: center;
      margin-top: 16px;
    }
    
    .captcha-loader, .captcha-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      text-align: center;
    }
    
    .spinner {
      border: 4px solid rgba(0, 0, 0, 0.1);
      border-left-color: #007bff;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .debug-info {
      margin-top: 16px;
      color: #666;
      text-align: center;
    }
  `],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PhysicalWorldComponent),
      multi: true
    }
  ]
})
export class PhysicalWorldComponent implements OnInit, ControlValueAccessor {
  captchaForm = new FormGroup({
    selectedOption: new FormControl('', [Validators.required])
  });
  
  challenge: PhysicalWorldChallenge | null = null;
  isLoading = false;
  error = '';
  
  selectedOptionId: string | null = null;
  
  private onChange: (value: any) => void = () => {};
  private onTouched: () => void = () => {};
  
  // Mock data for physical world understanding challenges
  private challenges: PhysicalWorldChallenge[] = [
    {
      challengeId: 'pw_001',
      scenario: 'You are camping in the woods',
      question: 'Which item would be most essential?',
      correctAnswer: '3',
      options: [
        {
          id: '1',
          imageUrl: 'assets/captcha/physical-world/television.jpg',
          text: 'Television',
          isCorrect: false
        },
        {
          id: '2',
          imageUrl: 'assets/captcha/physical-world/gaming-console.jpg',
          text: 'Gaming Console',
          isCorrect: false
        },
        {
          id: '3',
          imageUrl: 'assets/captcha/physical-world/flashlight.jpg',
          text: 'Flashlight',
          isCorrect: true
        },
        {
          id: '4',
          imageUrl: 'assets/captcha/physical-world/high-heels.jpg',
          text: 'High Heel Shoes',
          isCorrect: false
        }
      ],
      debug: true
    },
    {
      challengeId: 'pw_002',
      scenario: 'There is a power outage in your home',
      question: 'Which item would be most useful?',
      correctAnswer: '2',
      options: [
        {
          id: '1',
          imageUrl: 'assets/captcha/physical-world/electric-fan.jpg',
          text: 'Electric Fan',
          isCorrect: false
        },
        {
          id: '2',
          imageUrl: 'assets/captcha/physical-world/candle.jpg',
          text: 'Candle',
          isCorrect: true
        },
        {
          id: '3',
          imageUrl: 'assets/captcha/physical-world/television.jpg',
          text: 'Television',
          isCorrect: false
        },
        {
          id: '4',
          imageUrl: 'assets/captcha/physical-world/blender.jpg',
          text: 'Blender',
          isCorrect: false
        }
      ],
      debug: true
    },
    {
      challengeId: 'pw_003',
      scenario: 'It is raining heavily outside',
      question: 'Which item would keep you dry?',
      correctAnswer: '1',
      options: [
        {
          id: '1',
          imageUrl: 'assets/captcha/physical-world/umbrella.jpg',
          text: 'Umbrella',
          isCorrect: true
        },
        {
          id: '2',
          imageUrl: 'assets/captcha/physical-world/sunglasses.jpg',
          text: 'Sunglasses',
          isCorrect: false
        },
        {
          id: '3',
          imageUrl: 'assets/captcha/physical-world/fan.jpg',
          text: 'Fan',
          isCorrect: false
        },
        {
          id: '4',
          imageUrl: 'assets/captcha/physical-world/hammer.jpg',
          text: 'Hammer',
          isCorrect: false
        }
      ],
      debug: true
    }
  ];
  
  constructor(private cdr: ChangeDetectorRef) {}
  
  ngOnInit(): void {
    this.refreshChallenge();
  }
  
  refreshChallenge(): void {
    this.isLoading = true;
    this.error = '';
    this.selectedOptionId = null;
    this.captchaForm.get('selectedOption')?.setValue('');
    
    // Simulate API call with delay
    setTimeout(() => {
      try {
        // Randomly select a challenge
        const randomIndex = Math.floor(Math.random() * this.challenges.length);
        this.challenge = this.challenges[randomIndex];
        
        this.isLoading = false;
        this.cdr.markForCheck();
      } catch (error) {
        this.error = 'Failed to load challenge. Please try again.';
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    }, 1000);
  }
  
  selectOption(optionId: string): void {
    this.selectedOptionId = optionId;
    this.captchaForm.get('selectedOption')?.setValue(optionId);
    
    if (this.challenge) {
      this.onChange({
        challengeId: this.challenge.challengeId,
        selectedAnswer: optionId
      });
      this.onTouched();
    }
  }
  
  // ControlValueAccessor methods
  writeValue(value: any): void {
    if (value && typeof value === 'string') {
      this.selectedOptionId = value;
      this.captchaForm.get('selectedOption')?.setValue(value, { emitEvent: false });
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
  
  // For validation in parent component
  validate(): boolean {
    return this.captchaForm.valid && !!this.selectedOptionId;
  }
  
  // Return the challenge data for validation
  getChallengeData(): { challengeId: string; selectedAnswer: string } | null {
    if (!this.challenge?.challengeId || !this.selectedOptionId) {
      return null;
    }
    
    return {
      challengeId: this.challenge.challengeId,
      selectedAnswer: this.selectedOptionId
    };
  }
  
  // Mark form as touched for validation
  markAsTouched(): void {
    this.onTouched();
    this.captchaForm.markAllAsTouched();
  }
} 