import { Component, OnInit, forwardRef, ChangeDetectorRef, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import { LoggerService } from '../../../../services/logging/logger.service';

interface ColorMapping {
  color: string;
  name: string;
}

interface VisualChallenge {
  challengeId: string;
  color: string;
  textColor: string;
  imageName: string;
  description: string;
  question: string;
  options: string[];
  // For color pattern type
  pattern?: ColorMapping[];
}

@Component({
  selector: 'app-visual-reasoning-captcha',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => VisualReasoningCaptchaComponent),
      multi: true
    }
  ],
  template: `
    <div class="visual-reasoning-captcha">
      <div class="challenge-container">
        <div class="challenge-image-placeholder" 
             [style.background-color]="challenge?.color"
             attr.aria-label="Visual challenge depicting {{challenge?.description}}">
          <div class="image-description" [style.color]="challenge?.textColor">{{challenge?.imageName}}</div>
          
          <!-- Display color pattern if available -->
          <div *ngIf="challenge?.pattern" class="color-pattern">
            <div *ngFor="let item of challenge?.pattern" 
                 class="pattern-item"
                 [style.background-color]="item.color"
                 [attr.title]="item.name">
              <span class="sr-only">{{item.name}}</span>
            </div>
            <div class="pattern-item pattern-item-question">?</div>
          </div>
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
    .visual-reasoning-captcha {
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
      height: 170px;
      border-radius: 6px;
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
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
      margin-bottom: 10px;
    }
    
    .color-pattern {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 10px;
      margin-top: 10px;
      width: 90%;
      background-color: rgba(255, 255, 255, 0.95);
      padding: 15px;
      border-radius: 10px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }
    
    .pattern-item {
      width: 35px;
      height: 35px;
      border-radius: 50%;
      border: 2px solid #333;
      position: relative;
    }
    
    .pattern-item:hover::after {
      content: attr(title);
      position: absolute;
      top: -30px;
      left: 50%;
      transform: translateX(-50%);
      background-color: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 1;
    }
    
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border-width: 0;
    }
    
    .pattern-item-question {
      background-color: white !important;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: bold;
      color: #333;
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
export class VisualReasoningCaptchaComponent implements OnInit, ControlValueAccessor {
  @Output() valueChange = new EventEmitter<any>();
  
  challenge: VisualChallenge | null = null;
  selectedAnswer: string | null = null;
  touched = false;
  disabled = false;
  
  private onChange: any = () => {};
  private onTouched: any = () => {};
  
  // Sample challenges with CSS color placeholders instead of image URLs
  private challenges: VisualChallenge[] = [
    {
      challengeId: 'vr_001',
      color: '#ffffff', // White background
      textColor: '#000000', // Black
      imageName: 'Pattern Sequence',
      description: 'A sequence of geometric shapes in a pattern',
      question: 'Which shape comes next in the sequence?',
      options: ['Circle', 'Square', 'Triangle', 'Diamond']
    },
    {
      challengeId: 'vr_002',
      color: '#ffffff', // White background
      textColor: '#000000', // Black
      imageName: 'Object Count',
      description: 'Multiple objects of different colors',
      question: 'How many blue objects are in this image?',
      options: ['2', '3', '4', '5']
    },
    {
      challengeId: 'vr_003',
      color: '#ffffff', // White background
      textColor: '#000000', // Black
      imageName: 'Spatial Positions',
      description: 'Geometric shapes arranged in various positions',
      question: 'Which object is above the red circle?',
      options: ['Star', 'Square', 'Triangle', 'None']
    },
    {
      challengeId: 'vr_004',
      color: '#ffffff', // White background for pattern
      textColor: '#000000', // Black
      imageName: 'Color Pattern',
      description: 'A pattern of colored dots',
      question: 'What color should come next in the pattern?',
      options: ['Red', 'Blue', 'Green', 'Yellow'],
      pattern: [
        { color: '#FF0000', name: 'Red' },
        { color: '#00FF00', name: 'Green' },
        { color: '#0000FF', name: 'Blue' },
        { color: '#FF0000', name: 'Red' },
        { color: '#00FF00', name: 'Green' }
      ] // Red, Green, Blue, Red, Green... (next is Blue)
    },
    {
      challengeId: 'vr_005',
      color: '#ffffff', // White background
      textColor: '#000000', // Black
      imageName: 'Color Pattern',
      description: 'A pattern of colored dots',
      question: 'What color should come next in the pattern?',
      options: ['Red', 'Blue', 'Green', 'Yellow'],
      pattern: [
        { color: '#FF0000', name: 'Red' },
        { color: '#FFFF00', name: 'Yellow' },
        { color: '#FF0000', name: 'Red' },
        { color: '#FFFF00', name: 'Yellow' }
      ] // Red, Yellow, Red, Yellow... (next is Red)
    },
    {
      challengeId: 'vr_006',
      color: '#ffffff', // White background
      textColor: '#000000', // Black
      imageName: 'Color Pattern',
      description: 'A pattern of colored dots',
      question: 'What color should come next in the pattern?',
      options: ['Red', 'Blue', 'Green', 'Yellow'],
      pattern: [
        { color: '#FF0000', name: 'Red' },
        { color: '#0000FF', name: 'Blue' },
        { color: '#00FF00', name: 'Green' },
        { color: '#FF0000', name: 'Red' },
        { color: '#0000FF', name: 'Blue' }
      ] // Red, Blue, Green, Red, Blue... (next is Green)
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
    this.logger.debug('Refreshing visual reasoning challenge');
    
    // Make sure to pick a color pattern challenge (vr_004, vr_005, or vr_006)
    const patternChallengeIds = ['vr_004', 'vr_005', 'vr_006'];
    const patternChallenges = this.challenges.filter(c => 
      patternChallengeIds.includes(c.challengeId)
    );
    
    const randomIndex = Math.floor(Math.random() * patternChallenges.length);
    this.challenge = patternChallenges[randomIndex];
    
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
      challengeType: 'visual-reasoning'
    };
    
    this.onChange(captchaData);
    this.valueChange.emit(captchaData);
    this.logger.debug('Visual reasoning answer selected:', captchaData);
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
      challengeType: 'visual-reasoning'
    };
  }
} 