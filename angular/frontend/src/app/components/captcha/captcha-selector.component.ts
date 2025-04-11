import { Component, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { environment } from '../../../environments/environment';

interface CaptchaImage {
  label: string;
  selected: boolean;
  containsTarget: boolean;
  color: string;
}

@Component({
  selector: 'app-captcha-selector',
  standalone: true,
  imports: [
    CommonModule,
    MatSelectModule,
    MatFormFieldModule,
    FormsModule,
    MatButtonModule,
    MatCardModule
  ],
  template: `
    <div class="captcha-container">
      <mat-form-field>
        <mat-label>Select CAPTCHA Type</mat-label>
        <mat-select [(ngModel)]="selectedType" (selectionChange)="onTypeChange()">
          <mat-option value="image">Image Recognition</mat-option>
          <mat-option value="logic">Logic Puzzle</mat-option>
          <mat-option value="math">Math Problem</mat-option>
        </mat-select>
      </mat-form-field>

      <div [ngSwitch]="selectedType">
        <div *ngSwitchCase="'image'" class="captcha-challenge">
          <mat-card>
            <mat-card-header>
              <mat-card-title>Image Recognition Challenge</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <p>Select all images that contain: <strong>{{ imageChallenge.target }}</strong></p>
              <div class="image-grid">
                <div *ngFor="let image of imageChallenge.images; let i = index" 
                     class="image-item"
                     [class.selected]="image.selected"
                     (click)="toggleImageSelection(i)"
                     (keyup.enter)="toggleImageSelection(i)"
                     tabindex="0">
                  <div class="placeholder-image" [style.background-color]="image.color">
                    <span class="image-text">{{ image.label }}</span>
                  </div>
                </div>
              </div>
            </mat-card-content>
            <mat-card-actions>
              <button mat-raised-button color="primary" (click)="verifyImageChallenge()">Verify</button>
            </mat-card-actions>
          </mat-card>
        </div>
        
        <div *ngSwitchCase="'logic'" class="captcha-challenge">
          <mat-card>
            <mat-card-header>
              <mat-card-title>Logic Puzzle</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <p>{{ logicChallenge.question }}</p>
              <div class="logic-options">
                <button 
                  *ngFor="let option of logicChallenge.options; let i = index"
                  mat-stroked-button
                  [class.selected]="i === logicChallenge.selectedOption"
                  (click)="selectLogicOption(i)">
                  {{ option }}
                </button>
              </div>
            </mat-card-content>
            <mat-card-actions>
              <button mat-raised-button color="primary" (click)="verifyLogicChallenge()">Verify</button>
            </mat-card-actions>
          </mat-card>
        </div>
        
        <div *ngSwitchCase="'math'" class="captcha-challenge">
          <mat-card>
            <mat-card-header>
              <mat-card-title>Math Problem</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <p>Solve the following problem:</p>
              <p class="math-problem">{{ mathChallenge.problem }}</p>
              <input type="text" [(ngModel)]="mathChallenge.userAnswer" placeholder="Your answer">
            </mat-card-content>
            <mat-card-actions>
              <button mat-raised-button color="primary" (click)="verifyMathChallenge()">Verify</button>
            </mat-card-actions>
          </mat-card>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .captcha-container {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1rem;
      max-width: 500px;
    }
    
    .captcha-challenge {
      margin-top: 1rem;
    }
    
    .image-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin: 1rem 0;
    }
    
    .image-item {
      height: 120px;
      border: 1px solid #ccc;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      overflow: hidden;
      position: relative;
    }
    
    .image-item.selected {
      border: 3px solid #3f51b5;
    }
    
    .placeholder-image {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      text-align: center;
      padding: 10px;
      box-sizing: border-box;
      transition: transform 0.3s ease;
    }
    
    .image-text {
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
    }
    
    .image-item:hover .placeholder-image {
      transform: scale(1.05);
    }
    
    .logic-options {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 1rem 0;
    }
    
    .logic-options button.selected {
      background-color: #e3f2fd;
    }
    
    .math-problem {
      font-size: 1.2rem;
      font-weight: bold;
      margin: 1rem 0;
    }
  `]
})
export class CaptchaSelectorComponent implements OnInit {
  @Output() captchaVerified = new EventEmitter<boolean>();
  
  selectedType: 'image' | 'logic' | 'math' = 'image';
  difficulty: 'easy' | 'medium' | 'hard' = environment.captcha.difficulty;
  
  imageChallenge = {
    target: 'bicycles',
    images: [
      { 
        label: 'Car', 
        selected: false, 
        containsTarget: false,
        color: '#3498db' 
      },
      { 
        label: 'Bicycle', 
        selected: false, 
        containsTarget: true,
        color: '#2ecc71' 
      },
      { 
        label: 'Tree', 
        selected: false, 
        containsTarget: false,
        color: '#27ae60' 
      },
      { 
        label: 'Bicycle Race', 
        selected: false, 
        containsTarget: true,
        color: '#e74c3c' 
      },
      { 
        label: 'House', 
        selected: false, 
        containsTarget: false,
        color: '#9b59b6' 
      },
      { 
        label: 'Mountain', 
        selected: false, 
        containsTarget: false,
        color: '#f1c40f' 
      },
      { 
        label: 'Child on Bicycle', 
        selected: false, 
        containsTarget: true,
        color: '#1abc9c' 
      },
      { 
        label: 'Lake', 
        selected: false, 
        containsTarget: false,
        color: '#3498db' 
      },
      { 
        label: 'Dog', 
        selected: false, 
        containsTarget: false,
        color: '#e67e22' 
      }
    ] as CaptchaImage[]
  };
  
  logicChallenge = {
    question: 'If all cats have tails, and Fluffy is a cat, then:',
    options: [
      'Fluffy might not have a tail',
      'Fluffy has a tail',
      'All tailed animals are cats',
      'None of the above'
    ],
    selectedOption: -1,
    correctOption: 1
  };
  
  mathChallenge = {
    problem: 'Calculate: (3 × 7) + 6 - 4 ÷ 2',
    userAnswer: '',
    correctAnswer: '23'
  };

  ngOnInit() {
    this.generateRandomChallenge();
  }

  onTypeChange() {
    this.captchaVerified.emit(false); // Reset verification when type changes
    this.generateRandomChallenge();
  }
  
  generateRandomChallenge() {
    // Here we would implement logic to generate random challenges
    // For now, using static examples
    
    if (this.selectedType === 'math') {
      this.generateMathProblem();
    }

    console.log(`Generating ${this.selectedType} challenge with ${this.difficulty} difficulty`);
  }
  
  generateMathProblem() {
    const operations = ['+', '-', '×', '÷'];
    const maxNumber = this.getDifficultyValue(10, 20, 50);
    const operationCount = this.getDifficultyValue(2, 3, 4);
    
    const numbers: number[] = [];
    const ops: string[] = [];
    
    // Generate numbers and operations based on difficulty
    for (let i = 0; i < operationCount; i++) {
      numbers.push(Math.floor(Math.random() * maxNumber) + 1);
      if (i < operationCount - 1) {
        ops.push(operations[Math.floor(Math.random() * (this.difficulty === 'easy' ? 2 : 4))]);
      }
    }
    
    // Create the problem string
    let problemString = `Calculate: ${numbers[0]}`;
    for (let i = 0; i < ops.length; i++) {
      problemString += ` ${ops[i]} ${numbers[i+1]}`;
    }
    
    this.mathChallenge.problem = problemString;
    
    // Calculate the answer
    let answer = numbers[0];
    for (let i = 0; i < ops.length; i++) {
      const nextNum = numbers[i+1];
      switch(ops[i]) {
        case '+': answer += nextNum; break;
        case '-': answer -= nextNum; break;
        case '×': answer *= nextNum; break;
        case '÷': answer /= nextNum; break;
      }
    }
    
    // For hard difficulty, round to 2 decimal places
    if (this.difficulty === 'hard' && answer % 1 !== 0) {
      answer = Math.round(answer * 100) / 100;
    }
    
    this.mathChallenge.correctAnswer = answer.toString();
    this.mathChallenge.userAnswer = '';
  }
  
  // Helper method to get values based on difficulty
  private getDifficultyValue(easy: number, medium: number, hard: number): number {
    switch(this.difficulty) {
      case 'easy': return easy;
      case 'medium': return medium;
      case 'hard': return hard;
    }
  }
  
  toggleImageSelection(index: number) {
    this.imageChallenge.images[index].selected = !this.imageChallenge.images[index].selected;
  }
  
  selectLogicOption(index: number) {
    this.logicChallenge.selectedOption = index;
  }
  
  verifyImageChallenge() {
    const isCorrect = this.imageChallenge.images.every(image => 
      (image.containsTarget && image.selected) || (!image.containsTarget && !image.selected)
    );
    
    this.captchaVerified.emit(isCorrect);
  }
  
  verifyLogicChallenge() {
    const isCorrect = this.logicChallenge.selectedOption === this.logicChallenge.correctOption;
    this.captchaVerified.emit(isCorrect);
  }
  
  verifyMathChallenge() {
    const isCorrect = this.mathChallenge.userAnswer === this.mathChallenge.correctAnswer;
    this.captchaVerified.emit(isCorrect);
  }
} 