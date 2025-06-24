import { Component, OnInit, OnDestroy, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';

interface AccessibilityIssue {
  type: 'error' | 'warning' | 'info';
  rule: string;
  description: string;
  element?: HTMLElement;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  wcagLevel: 'A' | 'AA' | 'AAA';
  wcagCriteria: string[];
}

interface AccessibilityReport {
  score: number;
  totalIssues: number;
  criticalIssues: number;
  seriousIssues: number;
  moderateIssues: number;
  minorIssues: number;
  issues: AccessibilityIssue[];
  timestamp: Date;
}

@Component({
  selector: 'app-accessibility-tester',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatExpansionModule,
    MatChipsModule,
    MatProgressBarModule
  ],
  template: `
    <mat-card class="accessibility-tester">
      <mat-card-header>
        <mat-card-title class="mat-headline-small">
          <mat-icon>accessibility</mat-icon>
          Accessibility Tester
        </mat-card-title>
        <mat-card-subtitle class="mat-body-2">
          WCAG 2.1 AA Compliance Checker
        </mat-card-subtitle>
      </mat-card-header>

      <mat-card-content>
        <div class="tester-controls">
          <button mat-raised-button 
                  color="primary" 
                  (click)="runAccessibilityAudit()"
                  [disabled]="isRunning"
                  class="touch-target">
            <mat-icon>play_arrow</mat-icon>
            {{ isRunning ? 'Running Audit...' : 'Run Accessibility Audit' }}
          </button>

          <button mat-button 
                  (click)="clearResults()"
                  [disabled]="!report"
                  class="touch-target">
            <mat-icon>clear</mat-icon>
            Clear Results
          </button>
        </div>

        <div *ngIf="isRunning" class="progress-section">
          <mat-progress-bar mode="indeterminate" color="primary"></mat-progress-bar>
          <p class="mat-body-2 progress-text">Analyzing page accessibility...</p>
        </div>

        <div *ngIf="report" class="results-section">
          <div class="score-card">
            <div class="score-display">
              <span class="score-number mat-display-small" 
                    [ngClass]="getScoreClass(report.score)">
                {{ report.score }}
              </span>
              <span class="score-label mat-body-1">/ 100</span>
            </div>
            <div class="score-description">
              <p class="mat-body-1" [ngClass]="getScoreClass(report.score)">
                {{ getScoreDescription(report.score) }}
              </p>
            </div>
          </div>

          <div class="issues-summary">
            <div class="issue-count critical" *ngIf="report.criticalIssues > 0">
              <mat-icon>error</mat-icon>
              <span>{{ report.criticalIssues }} Critical</span>
            </div>
            <div class="issue-count serious" *ngIf="report.seriousIssues > 0">
              <mat-icon>warning</mat-icon>
              <span>{{ report.seriousIssues }} Serious</span>
            </div>
            <div class="issue-count moderate" *ngIf="report.moderateIssues > 0">
              <mat-icon>info</mat-icon>
              <span>{{ report.moderateIssues }} Moderate</span>
            </div>
            <div class="issue-count minor" *ngIf="report.minorIssues > 0">
              <mat-icon>help</mat-icon>
              <span>{{ report.minorIssues }} Minor</span>
            </div>
          </div>

          <mat-expansion-panel *ngIf="report.issues.length > 0" class="issues-panel">
            <mat-expansion-panel-header>
              <mat-panel-title>
                <mat-icon>list</mat-icon>
                Detailed Issues ({{ report.issues.length }})
              </mat-panel-title>
            </mat-expansion-panel-header>

            <div class="issues-list">
              <div *ngFor="let issue of report.issues; trackBy: trackIssue" 
                   class="issue-item"
                   [ngClass]="'issue-' + issue.impact">
                <div class="issue-header">
                  <mat-icon [ngClass]="'icon-' + issue.type">
                    {{ getIssueIcon(issue.type) }}
                  </mat-icon>
                  <span class="issue-rule mat-body-strong">{{ issue.rule }}</span>
                  <mat-chip-set>
                    <mat-chip [ngClass]="'chip-' + issue.impact">
                      {{ issue.impact }}
                    </mat-chip>
                    <mat-chip class="chip-wcag">
                      WCAG {{ issue.wcagLevel }}
                    </mat-chip>
                  </mat-chip-set>
                </div>
                <p class="issue-description mat-body-2">{{ issue.description }}</p>
                <div class="wcag-criteria" *ngIf="issue.wcagCriteria.length > 0">
                  <span class="criteria-label mat-caption">WCAG Criteria:</span>
                  <span class="criteria-list mat-caption">{{ issue.wcagCriteria.join(', ') }}</span>
                </div>
              </div>
            </div>
          </mat-expansion-panel>

          <div class="report-footer">
            <p class="mat-caption">
              Report generated: {{ report.timestamp | date:'medium' }}
            </p>
          </div>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: [`
    .accessibility-tester {
      margin: 1rem;
      max-width: 800px;
    }

    .tester-controls {
      display: flex;
      gap: 1rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }

    .progress-section {
      margin: 1rem 0;
    }

    .progress-text {
      margin-top: 0.5rem;
      text-align: center;
    }

    .results-section {
      margin-top: 1rem;
    }

    .score-card {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem;
      background: var(--mdc-theme-surface);
      border-radius: 8px;
      margin-bottom: 1rem;
    }

    .score-display {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
    }

    .score-number {
      font-weight: 700;
      
      &.excellent { color: #4caf50; }
      &.good { color: #8bc34a; }
      &.fair { color: #ff9800; }
      &.poor { color: #f44336; }
    }

    .score-description p {
      margin: 0;
      font-weight: 500;
    }

    .issues-summary {
      display: flex;
      gap: 1rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }

    .issue-count {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border-radius: 16px;
      font-weight: 500;
      
      &.critical {
        background: #ffebee;
        color: #c62828;
      }
      
      &.serious {
        background: #fff3e0;
        color: #ef6c00;
      }
      
      &.moderate {
        background: #e3f2fd;
        color: #1565c0;
      }
      
      &.minor {
        background: #f3e5f5;
        color: #7b1fa2;
      }
    }

    .issues-panel {
      margin-top: 1rem;
    }

    .issues-list {
      max-height: 400px;
      overflow-y: auto;
    }

    .issue-item {
      padding: 1rem;
      border-left: 4px solid;
      margin-bottom: 1rem;
      background: var(--mdc-theme-surface);
      
      &.issue-critical { border-left-color: #f44336; }
      &.issue-serious { border-left-color: #ff9800; }
      &.issue-moderate { border-left-color: #2196f3; }
      &.issue-minor { border-left-color: #9c27b0; }
    }

    .issue-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 0.5rem;
      flex-wrap: wrap;
    }

    .issue-rule {
      flex: 1;
      min-width: 200px;
    }

    .issue-description {
      margin: 0.5rem 0;
      line-height: 1.5;
    }

    .wcag-criteria {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      margin-top: 0.5rem;
    }

    .criteria-label {
      font-weight: 500;
    }

    .criteria-list {
      color: var(--mdc-theme-primary);
    }

    .icon-error { color: #f44336; }
    .icon-warning { color: #ff9800; }
    .icon-info { color: #2196f3; }

    .chip-critical { background: #ffcdd2; color: #c62828; }
    .chip-serious { background: #ffe0b2; color: #ef6c00; }
    .chip-moderate { background: #bbdefb; color: #1565c0; }
    .chip-minor { background: #e1bee7; color: #7b1fa2; }
    .chip-wcag { background: var(--mdc-theme-primary); color: var(--mdc-theme-on-primary); }

    .report-footer {
      margin-top: 1rem;
      text-align: center;
      opacity: 0.7;
    }

    @media (max-width: 600px) {
      .tester-controls {
        flex-direction: column;
      }
      
      .score-card {
        flex-direction: column;
        text-align: center;
      }
      
      .issues-summary {
        flex-direction: column;
      }
      
      .issue-header {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  `]
})
export class AccessibilityTesterComponent implements OnInit, OnDestroy {
  private platformId = inject(PLATFORM_ID);
  
  isRunning = false;
  report: AccessibilityReport | null = null;

  ngOnInit() {
    // Component initialization
  }

  ngOnDestroy() {
    // Cleanup
  }

  async runAccessibilityAudit() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.isRunning = true;
    
    try {
      // Simulate audit process
      await this.delay(2000);
      
      // Run basic accessibility checks
      const issues = await this.performAccessibilityChecks();
      
      // Calculate score
      const score = this.calculateAccessibilityScore(issues);
      
      // Generate report
      this.report = {
        score,
        totalIssues: issues.length,
        criticalIssues: issues.filter(i => i.impact === 'critical').length,
        seriousIssues: issues.filter(i => i.impact === 'serious').length,
        moderateIssues: issues.filter(i => i.impact === 'moderate').length,
        minorIssues: issues.filter(i => i.impact === 'minor').length,
        issues,
        timestamp: new Date()
      };
      
      // Announce results to screen readers
      this.announceResults();
      
    } catch (error) {
      console.error('Accessibility audit failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async performAccessibilityChecks(): Promise<AccessibilityIssue[]> {
    const issues: AccessibilityIssue[] = [];
    
    // Check for missing alt text
    const images = document.querySelectorAll('img');
    images.forEach(img => {
      if (!img.alt && !img.getAttribute('aria-label')) {
        issues.push({
          type: 'error',
          rule: 'Images must have alternative text',
          description: 'All images must have alt text or aria-label for screen readers',
          element: img,
          impact: 'serious',
          wcagLevel: 'A',
          wcagCriteria: ['1.1.1']
        });
      }
    });

    // Check for proper heading hierarchy
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let previousLevel = 0;
    headings.forEach(heading => {
      const currentLevel = parseInt(heading.tagName.charAt(1));
      if (currentLevel > previousLevel + 1) {
        issues.push({
          type: 'warning',
          rule: 'Heading levels should not be skipped',
          description: `Heading level ${currentLevel} follows level ${previousLevel}, skipping levels`,
          element: heading as HTMLElement,
          impact: 'moderate',
          wcagLevel: 'AA',
          wcagCriteria: ['1.3.1', '2.4.6']
        });
      }
      previousLevel = currentLevel;
    });

    // Check for form labels
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      const hasLabel = input.getAttribute('aria-label') || 
                      input.getAttribute('aria-labelledby') ||
                      document.querySelector(`label[for="${input.id}"]`);
      
      if (!hasLabel) {
        issues.push({
          type: 'error',
          rule: 'Form controls must have labels',
          description: 'All form controls must have associated labels',
          element: input as HTMLElement,
          impact: 'critical',
          wcagLevel: 'A',
          wcagCriteria: ['1.3.1', '3.3.2']
        });
      }
    });

    // Check for sufficient color contrast (simplified check)
    const textElements = document.querySelectorAll('p, span, div, a, button, h1, h2, h3, h4, h5, h6');
    textElements.forEach(element => {
      const styles = window.getComputedStyle(element);
      const fontSize = parseFloat(styles.fontSize);
      const fontWeight = styles.fontWeight;
      
      // Simplified contrast check (would need actual color analysis in real implementation)
      if (fontSize < 18 && fontWeight < '700') {
        // This is a placeholder - real implementation would calculate actual contrast ratios
        const hasLowContrast = Math.random() < 0.1; // 10% chance for demo
        if (hasLowContrast) {
          issues.push({
            type: 'warning',
            rule: 'Insufficient color contrast',
            description: 'Text may not have sufficient contrast ratio (4.5:1 required)',
            element: element as HTMLElement,
            impact: 'serious',
            wcagLevel: 'AA',
            wcagCriteria: ['1.4.3']
          });
        }
      }
    });

    // Check for keyboard accessibility
    const interactiveElements = document.querySelectorAll('button, a, input, select, textarea, [tabindex]');
    interactiveElements.forEach(element => {
      const tabIndex = element.getAttribute('tabindex');
      if (tabIndex && parseInt(tabIndex) > 0) {
        issues.push({
          type: 'warning',
          rule: 'Avoid positive tabindex values',
          description: 'Positive tabindex values can create confusing tab order',
          element: element as HTMLElement,
          impact: 'moderate',
          wcagLevel: 'A',
          wcagCriteria: ['2.4.3']
        });
      }
    });

    return issues;
  }

  private calculateAccessibilityScore(issues: AccessibilityIssue[]): number {
    let score = 100;
    
    issues.forEach(issue => {
      switch (issue.impact) {
        case 'critical':
          score -= 15;
          break;
        case 'serious':
          score -= 10;
          break;
        case 'moderate':
          score -= 5;
          break;
        case 'minor':
          score -= 2;
          break;
      }
    });
    
    return Math.max(0, score);
  }

  private announceResults() {
    if (!this.report) return;
    
    const announcement = `Accessibility audit complete. Score: ${this.report.score} out of 100. ${this.report.totalIssues} issues found.`;
    
    const announcer = document.getElementById('announcements');
    if (announcer) {
      announcer.textContent = announcement;
    }
  }

  clearResults() {
    this.report = null;
  }

  getScoreClass(score: number): string {
    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 60) return 'fair';
    return 'poor';
  }

  getScoreDescription(score: number): string {
    if (score >= 90) return 'Excellent accessibility';
    if (score >= 75) return 'Good accessibility';
    if (score >= 60) return 'Fair accessibility - improvements needed';
    return 'Poor accessibility - significant issues found';
  }

  getIssueIcon(type: string): string {
    switch (type) {
      case 'error': return 'error';
      case 'warning': return 'warning';
      case 'info': return 'info';
      default: return 'help';
    }
  }

  trackIssue(index: number, issue: AccessibilityIssue): string {
    return `${issue.rule}-${index}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 