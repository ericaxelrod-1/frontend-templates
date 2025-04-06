import { Component, OnInit, forwardRef, ChangeDetectorRef, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import { LoggerService } from '../../../../services/logging/logger.service';

interface WorldChallenge {
  challengeId: string;
  color: string;
  textColor: string;
  imageName: string;
  description: string;
  question: string;
  options: string[];
}

@Component({
  selector: 'app-physical-world-captcha',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PhysicalWorldCaptchaComponent),
      multi: true
    }
  ],
  template: `
    <div class="physical-world-captcha">
      <div class="challenge-container">
        <div class="challenge-image-placeholder" 
             [style.background-color]="challenge?.color"
             attr.aria-label="Image depicting {{challenge?.description}}">
          <div class="image-description" [style.color]="challenge?.textColor">{{challenge?.imageName}}</div>
        </div>
        <div class="challenge-question">{{ challenge?.question }}</div>
      </div>
      
      <div class="options-container">
        <div 
          *ngFor="let option of challenge?.options; let i = index" 
          class="option-item"
          [class.selected]="selectedAnswer === option"
          (click)="selectAnswer(option)"
          [attr.aria-pressed]="selectedAnswer === option"
          [attr.role]="'button'"
          [attr.tabindex]="0"
          (keydown.enter)="selectAnswer(option)"
          (keydown.space)="selectAnswer(option); $event.preventDefault()">
          {{ option }}
        </div>
      </div>

      <div class="captcha-actions">
        <button type="button" 
                class="refresh-btn" 
                (click)="refreshChallenge()"
                aria-label="Get a new challenge">
          <span aria-hidden="true">↻</span> New Challenge
        </button>
      </div>
    </div>
  `,
  styles: [`
    .physical-world-captcha {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 16px;
      background-color: #f9f9f9;
      max-width: 400px;
    }
    
    .challenge-container {
      margin-bottom: 16px;
    }
    
    .challenge-image-placeholder {
      width: 100%;
      height: 160px;
      border-radius: 6px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    
    .image-description {
      font-size: 1.5rem;
      text-align: center;
      padding: 10px;
      background-color: rgba(255, 255, 255, 0.85);
      border-radius: 5px;
      padding: 8px 16px;
      font-weight: bold;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }
    
    .challenge-question {
      font-weight: bold;
      margin-bottom: 12px;
      font-size: 1rem;
      color: #333;
    }
    
    .options-container {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-bottom: 16px;
    }
    
    .option-item {
      padding: 10px;
      border: 1px solid #ccc;
      border-radius: 4px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
      background-color: #ffffff;
      color: #333333;
      font-weight: 500;
    }
    
    .option-item:hover, .option-item:focus {
      background-color: #e0e0e0;
      outline: none;
      box-shadow: 0 0 0 2px #2196f3;
    }
    
    .option-item.selected {
      background-color: #e0f7fa;
      border-color: #00bcd4;
    }
    
    .captcha-actions {
      display: flex;
      justify-content: flex-end;
    }
    
    .refresh-btn {
      background: none;
      border: none;
      color: #2196f3;
      cursor: pointer;
      padding: 5px 10px;
      font-size: 0.9em;
      font-weight: 500;
    }
    
    .refresh-btn:hover, .refresh-btn:focus {
      text-decoration: underline;
      outline: none;
      color: #0d47a1;
    }
  `]
})
export class PhysicalWorldCaptchaComponent implements OnInit, ControlValueAccessor {
  @Output() valueChange = new EventEmitter<any>();
  
  challenge: WorldChallenge | null = null;
  selectedAnswer: string | null = null;
  touched = false;
  disabled = false;
  
  private onChange: any = () => {};
  private onTouched: any = () => {};
  
  // Sample challenges with CSS color placeholders instead of image URLs
  private challenges: WorldChallenge[] = [
    {
      challengeId: 'pw_001',
      color: '#4a90e2', // Blue
      textColor: '#000000', // Black
      imageName: 'Rainy Day',
      description: 'A gray cloudy sky with rain falling',
      question: 'What weather condition is shown in this image?',
      options: ['Sunny', 'Rainy', 'Snowy', 'Cloudy']
    },
    {
      challengeId: 'pw_002',
      color: '#f39c12', // Orange
      textColor: '#000000', // Black
      imageName: 'Sunset',
      description: 'An orange sky at sunset',
      question: 'What time of day is shown in this image?',
      options: ['Morning', 'Afternoon', 'Evening', 'Night']
    },
    {
      challengeId: 'pw_003',
      color: '#2ecc71', // Green
      textColor: '#000000', // Black
      imageName: 'Spring Flowers',
      description: 'A field of blooming flowers in spring',
      question: 'Which season is depicted in this image?',
      options: ['Spring', 'Summer', 'Fall', 'Winter']
    },
    {
      challengeId: 'pw_004',
      color: '#e74c3c', // Red
      textColor: '#000000', // Black
      imageName: 'Autumn Leaves',
      description: 'Red and orange falling leaves',
      question: 'Which season is depicted in this image?',
      options: ['Spring', 'Summer', 'Fall', 'Winter']
    },
    {
      challengeId: 'pw_005',
      color: '#3498db', // Light Blue
      textColor: '#000000', // Black
      imageName: 'Swimming Pool',
      description: 'A blue swimming pool on a sunny day',
      question: 'What activity is this image associated with?',
      options: ['Swimming', 'Hiking', 'Skiing', 'Cycling']
    }
  ];
  
  constructor(
    private cdr: ChangeDetectorRef,
    private logger: LoggerService
  ) {}
  
  ngOnInit(): void {
    this.refreshChallenge();
  }
  
  refreshChallenge(): void {
    this.logger.debug('Refreshing physical world challenge');
    const randomIndex = Math.floor(Math.random() * this.challenges.length);
    this.challenge = this.challenges[randomIndex];
    this.selectedAnswer = null;
    this.onChange(null);
    this.cdr.detectChanges();
  }
  
  selectAnswer(answer: string): void {
    if (this.disabled) return;
    
    this.selectedAnswer = answer;
    this.markAsTouched();
    
    // Prepare the data object to emit
    const captchaData = {
      challengeId: this.challenge?.challengeId,
      selectedAnswer: answer,
      challengeType: 'physical-world'
    };
    
    this.onChange(captchaData);
    this.valueChange.emit(captchaData);
    this.logger.debug('Physical world answer selected:', captchaData);
  }
  
  writeValue(value: any): void {
    // This method is called when the form control value is set from the outside
    // Only set selectedAnswer if we have a valid value object
    if (value && value.selectedAnswer) {
      this.selectedAnswer = value.selectedAnswer;
    } else {
      this.selectedAnswer = null;
    }
    this.cdr.detectChanges();
  }
  
  registerOnChange(fn: any): void {
    this.onChange = fn;
  }
  
  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }
  
  markAsTouched(): void {
    if (!this.touched) {
      this.touched = true;
      this.onTouched();
    }
  }
  
  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    this.cdr.detectChanges();
  }
  
  // Method to access component data directly
  getCaptchaData(): any {
    if (!this.challenge || !this.selectedAnswer) return null;
    
    return {
      challengeId: this.challenge.challengeId,
      selectedAnswer: this.selectedAnswer,
      challengeType: 'physical-world'
    };
  }
} 