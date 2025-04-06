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

// Interface for visual reasoning captcha
export interface VisualReasoningItem {
  id: string;
  imageUrl: string;
  properties: {
    breakable?: boolean;
    heavy?: boolean;
    flammable?: boolean;
    loud?: boolean;
    sharp?: boolean;
    [key: string]: boolean | undefined;
  };
}

// Interface for visual reasoning challenge
export interface VisualReasoningChallenge {
  challengeId: string;
  question: string;
  property: string;
  items: VisualReasoningItem[];
  correctAnswer: string;
  debug?: boolean;
}

@Component({
  selector: 'app-visual-reasoning',
  template: `
    <form [formGroup]="captchaForm" class="visual-reasoning-container">
      <div class="challenge-question">
        <h3>{{ challenge?.question }}</h3>
      </div>
      
      <div *ngIf="isLoading" class="captcha-loader">
        <div class="spinner"></div>
      </div>
      
      <div *ngIf="error" class="captcha-error">
        {{ error }}
        <button type="button" class="btn btn-link" (click)="refreshChallenge()">Try again</button>
      </div>
      
      <div *ngIf="!isLoading && !error" class="image-grid">
        <div 
          *ngFor="let item of challenge?.items" 
          class="image-item"
          [class.selected]="selectedItemId === item.id"
          (click)="selectItem(item.id)"
        >
          <img [src]="item.imageUrl" [alt]="'Option ' + item.id">
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
    .visual-reasoning-container {
      display: flex;
      flex-direction: column;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 16px;
      margin-bottom: 20px;
    }
    
    .challenge-question {
      margin-bottom: 16px;
      text-align: center;
    }
    
    .image-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      grid-gap: 16px;
      margin-bottom: 16px;
    }
    
    .image-item {
      cursor: pointer;
      border: 3px solid transparent;
      border-radius: 8px;
      overflow: hidden;
      transition: all 0.2s ease;
    }
    
    .image-item:hover {
      transform: scale(1.05);
    }
    
    .image-item.selected {
      border-color: #007bff;
      box-shadow: 0 0 8px rgba(0,123,255,0.5);
    }
    
    .image-item img {
      width: 100%;
      height: auto;
      object-fit: cover;
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
      useExisting: forwardRef(() => VisualReasoningComponent),
      multi: true
    }
  ]
})
export class VisualReasoningComponent implements OnInit, ControlValueAccessor {
  captchaForm = new FormGroup({
    selectedItem: new FormControl('', [Validators.required])
  });
  
  challenge: VisualReasoningChallenge | null = null;
  isLoading = false;
  error = '';
  
  selectedItemId: string | null = null;
  
  private onChange: (value: any) => void = () => {};
  private onTouched: () => void = () => {};
  
  // Mock data for visual reasoning challenges
  private challenges: VisualReasoningChallenge[] = [
    {
      challengeId: 'vr_001',
      question: 'Which item would break if dropped?',
      property: 'breakable',
      correctAnswer: '2',
      items: [
        {
          id: '1',
          imageUrl: 'assets/captcha/visual-reasoning/ball.jpg',
          properties: { breakable: false, heavy: false }
        },
        {
          id: '2',
          imageUrl: 'assets/captcha/visual-reasoning/glass.jpg',
          properties: { breakable: true, heavy: false }
        },
        {
          id: '3',
          imageUrl: 'assets/captcha/visual-reasoning/book.jpg',
          properties: { breakable: false, heavy: false }
        },
        {
          id: '4',
          imageUrl: 'assets/captcha/visual-reasoning/pillow.jpg',
          properties: { breakable: false, heavy: false }
        }
      ],
      debug: true
    },
    {
      challengeId: 'vr_002',
      question: 'Which item would make the loudest noise?',
      property: 'loud',
      correctAnswer: '3',
      items: [
        {
          id: '1',
          imageUrl: 'assets/captcha/visual-reasoning/feather.jpg',
          properties: { loud: false, heavy: false }
        },
        {
          id: '2',
          imageUrl: 'assets/captcha/visual-reasoning/pillow.jpg',
          properties: { loud: false, heavy: false }
        },
        {
          id: '3',
          imageUrl: 'assets/captcha/visual-reasoning/drum.jpg',
          properties: { loud: true, heavy: false }
        },
        {
          id: '4',
          imageUrl: 'assets/captcha/visual-reasoning/sock.jpg',
          properties: { loud: false, heavy: false }
        }
      ],
      debug: true
    },
    {
      challengeId: 'vr_003',
      question: 'Which item can cut through paper?',
      property: 'sharp',
      correctAnswer: '4',
      items: [
        {
          id: '1',
          imageUrl: 'assets/captcha/visual-reasoning/banana.jpg',
          properties: { sharp: false, heavy: false }
        },
        {
          id: '2',
          imageUrl: 'assets/captcha/visual-reasoning/ball.jpg',
          properties: { sharp: false, heavy: false }
        },
        {
          id: '3',
          imageUrl: 'assets/captcha/visual-reasoning/pillow.jpg',
          properties: { sharp: false, heavy: false }
        },
        {
          id: '4',
          imageUrl: 'assets/captcha/visual-reasoning/scissors.jpg',
          properties: { sharp: true, heavy: false }
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
    this.selectedItemId = null;
    this.captchaForm.get('selectedItem')?.setValue('');
    
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
  
  selectItem(itemId: string): void {
    this.selectedItemId = itemId;
    this.captchaForm.get('selectedItem')?.setValue(itemId);
    
    if (this.challenge) {
      this.onChange({
        challengeId: this.challenge.challengeId,
        selectedAnswer: itemId
      });
      this.onTouched();
    }
  }
  
  // ControlValueAccessor methods
  writeValue(value: any): void {
    if (value && typeof value === 'string') {
      this.selectedItemId = value;
      this.captchaForm.get('selectedItem')?.setValue(value, { emitEvent: false });
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
    return this.captchaForm.valid && !!this.selectedItemId;
  }
  
  // Return the challenge data for validation
  getChallengeData(): { challengeId: string; selectedAnswer: string } | null {
    if (!this.challenge?.challengeId || !this.selectedItemId) {
      return null;
    }
    
    return {
      challengeId: this.challenge.challengeId,
      selectedAnswer: this.selectedItemId
    };
  }
  
  // Mark form as touched for validation
  markAsTouched(): void {
    this.onTouched();
    this.captchaForm.markAllAsTouched();
  }
} 